import { ARENA_SIZE, BATTLE_LIMIT_MS, CHARGE_PER_BOUNCE, HEAL_ON_CONTACT, MAX_CHARGE, PETS, SIMULATION_STEP_MS, validateLoadout } from '../shared/catalog.js';
import type { BattleEvent, BattleState, FighterState, PlayerInfo } from '../shared/types.js';

type Combatant = Pick<PlayerInfo, 'id' | 'name' | 'loadout'>;
interface Fighter { state: FighterState; attack: number; speed: number }
const CONTACT_RELEASE_GAP = 0.5;
const EPSILON = 0.000001;

function randomStream(seed: number, id: string): () => number {
  let value = seed >>> 0;
  for (const character of id) value = Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let result = Math.imul(value ^ (value >>> 15), value | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

/** Server-owned arcade physics. Network timing only adds time to the fixed-step
 * clock; health changes exclusively on a new ball contact, never on a timer. */
export class BattleSimulator {
  private readonly fighters: Fighter[];
  private elapsedMs = 0;
  private requestedMs = 0;
  private touching = false;
  private finished = false;
  private winnerId: string | null = null;
  private draw = false;
  private sequence = 0;

  constructor(players: Combatant[], seed: number) {
    if (players.length !== 2 || players[0].id === players[1].id || !Number.isFinite(seed)) {
      throw new Error('战斗需要两位不同的玩家和有效的随机种子。');
    }
    // Stable ordering prevents message arrival / seating order from deciding
    // initial geometry or which of two simultaneous hits is resolved first.
    this.fighters = [...players].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map((player, index) => {
      if (!validateLoadout(player.loadout)) throw new Error('搭配必须来自当前可用目录，并符合槽位上限。');
      const pet = PETS.find(entry => entry.id === player.loadout.petId)!;
      const random = randomStream(seed, player.id);
      const direction = index === 0 ? 1 : -1;
      const angle = (0.3 + random() * 0.7) * (random() < 0.5 ? -1 : 1);
      return {
        attack: pet.attack, speed: pet.speed,
        state: {
          id: player.id, name: player.name, petId: pet.id, hp: pet.hp, maxHp: pet.hp,
          x: ARENA_SIZE * (index === 0 ? 0.25 : 0.75), y: ARENA_SIZE / 2 + (random() - 0.5) * 80,
          vx: Math.cos(angle) * pet.speed * direction, vy: Math.sin(angle) * pet.speed,
          radius: pet.radius, charge: 0, wallBounces: 0, damageDealt: 0, healing: 0, hits: 0,
        },
      };
    });
  }

  snapshot(): BattleState {
    return {
      elapsedMs: this.elapsedMs, fighters: this.fighters.map(fighter => ({ ...fighter.state })),
      finished: this.finished, winnerId: this.winnerId, draw: this.draw,
    };
  }

  advance(deltaMs: number): BattleEvent[] {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) throw new RangeError('推进时间必须是非负有限数。');
    if (this.finished) return [];
    this.requestedMs = Math.min(BATTLE_LIMIT_MS, this.requestedMs + deltaMs);
    const events: BattleEvent[] = [];
    while (!this.finished && this.elapsedMs + SIMULATION_STEP_MS <= this.requestedMs + EPSILON) {
      this.elapsedMs += SIMULATION_STEP_MS;
      this.step(events);
      if (!this.finished && this.elapsedMs >= BATTLE_LIMIT_MS) this.finish(events, true);
    }
    return events;
  }

  private step(events: BattleEvent[]): void {
    const seconds = SIMULATION_STEP_MS / 1000;
    for (const fighter of this.fighters) {
      fighter.state.x += fighter.state.vx * seconds;
      fighter.state.y += fighter.state.vy * seconds;
      this.bounceWalls(fighter, events);
    }

    const [left, right] = this.fighters;
    const a = left.state, b = right.state;
    const dx = b.x - a.x, dy = b.y - a.y;
    const distance = Math.hypot(dx, dy);
    const minimum = a.radius + b.radius;
    if (distance > minimum + CONTACT_RELEASE_GAP) this.touching = false;
    if (distance > minimum) return;

    const nx = distance > EPSILON ? dx / distance : 1;
    const ny = distance > EPSILON ? dy / distance : 0;
    const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    this.separate(a, b, nx, ny, minimum - distance + EPSILON);
    if (relative < 0) {
      // Equal-mass elastic normal impulse; normalize afterwards so these
      // arcade balls retain their configured movement speed after glancing hits.
      a.vx += relative * nx; a.vy += relative * ny;
      b.vx -= relative * nx; b.vy -= relative * ny;
      this.restoreSpeed(left, -nx, -ny);
      this.restoreSpeed(right, nx, ny);
    }
    const newContact = !this.touching;
    this.touching = true;
    if (newContact && relative < 0) this.resolveContact(events);
  }

  private bounceWalls(fighter: Fighter, events: BattleEvent[]): void {
    const state = fighter.state;
    const minimum = state.radius, maximum = ARENA_SIZE - state.radius;
    let bounced = false;
    if (state.x < minimum) { state.x = minimum + (minimum - state.x); state.vx = Math.abs(state.vx); bounced = true; }
    else if (state.x > maximum) { state.x = maximum - (state.x - maximum); state.vx = -Math.abs(state.vx); bounced = true; }
    if (state.y < minimum) { state.y = minimum + (minimum - state.y); state.vy = Math.abs(state.vy); bounced = true; }
    else if (state.y > maximum) { state.y = maximum - (state.y - maximum); state.vy = -Math.abs(state.vy); bounced = true; }
    if (!bounced) return;
    state.wallBounces += 1; // A corner reflects two axes but is one wall contact.
    if (state.petId !== 'charge' || state.charge >= MAX_CHARGE) return;
    const increase = Math.min(CHARGE_PER_BOUNCE, MAX_CHARGE - state.charge);
    state.charge += increase;
    this.emit(events, 'charge', fighter, fighter, increase, `${state.name} 撞墙蓄力，下一次碰撞伤害 +${state.charge}`);
  }

  private restoreSpeed(fighter: Fighter, nx: number, ny: number): void {
    const speed = Math.hypot(fighter.state.vx, fighter.state.vy);
    if (speed <= EPSILON) { fighter.state.vx = nx * fighter.speed; fighter.state.vy = ny * fighter.speed; }
    else { fighter.state.vx *= fighter.speed / speed; fighter.state.vy *= fighter.speed / speed; }
  }

  private separate(a: FighterState, b: FighterState, nx: number, ny: number, overlap: number): void {
    // Allocate the correction to available space. A ball pinned to an edge
    // transfers its share to the other ball instead of being pushed out of bounds.
    const available = (state: FighterState, ux: number, uy: number): number => Math.min(
      Math.abs(ux) < EPSILON ? Infinity : ((ux > 0 ? ARENA_SIZE - state.radius : state.radius) - state.x) / ux,
      Math.abs(uy) < EPSILON ? Infinity : ((uy > 0 ? ARENA_SIZE - state.radius : state.radius) - state.y) / uy,
    );
    const roomA = Math.max(0, available(a, -nx, -ny));
    const roomB = Math.max(0, available(b, nx, ny));
    let moveA = Math.min(overlap / 2, roomA);
    const moveB = Math.min(overlap - moveA, roomB);
    moveA = Math.min(overlap - moveB, roomA);
    a.x -= nx * moveA; a.y -= ny * moveA;
    b.x += nx * moveB; b.y += ny * moveB;
  }

  private resolveContact(events: BattleEvent[]): void {
    const [left, right] = this.fighters;
    // Capture both attacks before changing either HP. Lethal hits still trade.
    const attacks = [
      { source: left, target: right, damage: Math.min(right.state.hp, left.attack + left.state.charge), charge: left.state.charge },
      { source: right, target: left, damage: Math.min(left.state.hp, right.attack + right.state.charge), charge: right.state.charge },
    ];
    for (const { source, target, damage, charge } of attacks) {
      target.state.hp -= damage;
      source.state.damageDealt += damage;
      source.state.hits += 1;
      source.state.charge = 0;
      this.emit(events, 'attack', source, target, damage, `${source.state.name} ${charge ? '蓄力碰撞' : '碰撞'}，对 ${target.state.name} 造成 ${damage} 点伤害`);
    }
    for (const fighter of this.fighters) {
      if (fighter.state.petId !== 'renew' || fighter.state.hp <= 0) continue;
      const amount = Math.min(HEAL_ON_CONTACT, fighter.state.maxHp - fighter.state.hp);
      if (amount <= 0) continue;
      fighter.state.hp += amount;
      fighter.state.healing += amount;
      this.emit(events, 'heal', fighter, fighter, amount, `${fighter.state.name} 碰撞后回春，恢复 ${amount} 点生命`);
    }
    if (this.fighters.some(fighter => fighter.state.hp <= 0)) this.finish(events, false);
  }

  private finish(events: BattleEvent[], timeout: boolean): void {
    this.finished = true;
    const [left, right] = this.fighters;
    const difference = timeout ? left.state.hp * right.state.maxHp - right.state.hp * left.state.maxHp : left.state.hp - right.state.hp;
    this.draw = difference === 0;
    const winner = this.draw ? null : difference > 0 ? left : right;
    this.winnerId = winner?.state.id ?? null;
    this.emit(events, 'end', winner ?? left, winner ?? right, 0,
      this.draw ? (timeout ? '时间到，剩余生命比例相同，本局平局' : '双方同时倒下，本局平局')
        : timeout ? `时间到，${winner!.state.name} 以剩余生命比例获胜` : `${winner!.state.name} 赢得了本局对战`);
  }

  private emit(events: BattleEvent[], kind: BattleEvent['kind'], source: Fighter, target: Fighter, amount: number, text: string): void {
    events.push({ seq: ++this.sequence, timeMs: this.elapsedMs, kind, sourceId: source.state.id, targetId: target.state.id, amount, text, x: target.state.x, y: target.state.y });
  }
}
