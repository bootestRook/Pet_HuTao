import { ARENA_SIZE, BATTLE_LIMIT_MS, PETS, SIMULATION_STEP_MS, validateLoadout } from '../shared/catalog.js';
import type { BattleEffect, BattleEvent, BattleState, DamageKind, FighterState, PlayerInfo } from '../shared/types.js';
import { BattleItems, createItemState, type ItemFighter } from './battle-items.js';
import { BattleWorld } from './battle-world.js';
import { LIANG_REDUCTION, LIANG_RETURN_BONUS, LIANG_YIELD_QUOTES, LIANG_RETURN_QUOTE } from '../shared/liangchushuo.js';
import { diceOutcome, HUTAO_DICE_HEAL, HUTAO_NOSTALGIA_HEAL, HUTAO_NOSTALGIA_THRESHOLD, HUTAO_QUOTES, HUTAO_ROLL_DURATION_MS, HUTAO_ROLL_INTERVAL_MS, HUTAO_SELF_DAMAGE, HUTAO_SLAP_DAMAGE } from '../shared/hutao.js';
import { CHENG_MEAL_THRESHOLD, CHENG_MEAL_HEAL, CHENG_MEAL_DURATION_MS, CHENG_MEAL_COOLDOWN_MS, CHENG_INVULNERABLE_MS, CHENG_GRAPPLE_THRESHOLD, CHENG_GRAPPLE_COOLDOWN_MS, CHENG_DASH_DURATION_MS, CHENG_BIND_DURATION_MS, CHENG_DRAIN_INTERVAL_MS, CHENG_DRAIN_DAMAGE, CHENG_QUOTES } from '../shared/chengzhiquan.js';

type Combatant = Pick<PlayerInfo, 'id' | 'name' | 'loadout'>;
interface Fighter extends ItemFighter { attack: number; random: () => number }
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

/** Server-owned physics and effects share a fixed simulation clock and seeded randomness. */
export class BattleSimulator {
  private readonly fighters: Fighter[];
  private readonly items: BattleItems;
  private readonly world: BattleWorld;
  private elapsedMs = 0;
  private requestedMs = 0;
  private processedMs = 0;
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
        attack: pet.attack, speed: pet.speed, baseRadius: pet.radius,
        random: randomStream(seed, `${player.id}:dice`), itemRandom: randomStream(seed, `${player.id}:items`),
        state: {
          id: player.id, name: player.name, petId: pet.id, hp: pet.hp, maxHp: pet.hp,
          x: ARENA_SIZE * (index === 0 ? 0.25 : 0.75), y: ARENA_SIZE / 2 + (random() - 0.5) * 80,
          vx: Math.cos(angle) * pet.speed * direction, vy: Math.sin(angle) * pet.speed,
          radius: pet.radius, wallBounces: 0, damageDealt: 0, healing: 0, hits: 0,
          nostalgiaUsed: false, diceRoll: null,
          liang: pet.id === 'liangchushuo' ? { phase: 'yield', contact: null } : null,
          boundUntilMs: 0,
          items: createItemState(player.loadout.items),
          world: { stunnedUntilMs: 0, invulnerableUntilMs: 0, damageBonus: 0 },
          cheng: pet.id === 'chengzhiquan' ? { mealStartedAtMs: null, nextMealAtMs: 0, meals: 0, survivalUsed: false, invulnerableUntilMs: 0, grappleUnlocked: false, nextGrappleAtMs: 0, dash: null, grapple: null } : null,
        },
      };
    });
    this.items = new BattleItems(this.fighters, {
      damage: (...args) => this.damage(...args),
      heal: (...args) => this.heal(...args),
      emit: (...args) => this.emit(...args),
    });
    this.world = new BattleWorld(this.fighters, randomStream(seed, 'battle:world'), {
      damage: (...args) => this.damage(...args),
      heal: (...args) => this.heal(...args),
      emit: (...args) => this.emit(...args),
    });
  }

  snapshot(): BattleState {
    return {
      elapsedMs: this.elapsedMs, fighters: this.fighters.map(({ state }) => structuredClone(state)), field: this.items.snapshot(),
      world: this.world.snapshot(),
      finished: this.finished, winnerId: this.winnerId, draw: this.draw,
    };
  }

  advance(deltaMs: number): BattleEvent[] {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) throw new RangeError('推进时间必须是非负有限数。');
    if (this.finished) return [];
    this.requestedMs += deltaMs;
    const events: BattleEvent[] = [];
    while (!this.finished && this.processedMs + SIMULATION_STEP_MS <= this.requestedMs + EPSILON) {
      this.processedMs += SIMULATION_STEP_MS;
      if (this.world.pauseStep(events)) continue;
      this.elapsedMs += SIMULATION_STEP_MS;
      this.items.prepareStep(this.elapsedMs, events);
      this.step(events);
      if (!this.finished) this.advanceHutao(events);
      if (!this.finished) this.advanceCheng(events);
      if (!this.finished) {
        this.items.advance(events);
        if (this.fighters.some(({ state }) => state.hp <= 0)) this.finish(events, false);
      }
      if (!this.finished) {
        this.world.advance(this.elapsedMs, events);
        if (this.fighters.some(({ state }) => state.hp <= 0)) this.finish(events, false);
      }
      if (!this.finished) this.items.recordHistory();
      if (!this.finished && this.elapsedMs >= BATTLE_LIMIT_MS) this.finish(events, true);
    }
    return events;
  }

  private step(events: BattleEvent[]): void {
    const seconds = SIMULATION_STEP_MS / 1000;
    for (const fighter of this.fighters) {
      if (fighter.state.boundUntilMs >= this.elapsedMs || fighter.state.world.stunnedUntilMs > this.elapsedMs || fighter.state.cheng?.dash) continue;
      fighter.state.x += fighter.state.vx * seconds;
      fighter.state.y += fighter.state.vy * seconds;
      this.bounceWalls(fighter, events);
    }
    this.advanceDashes(events);

    const [left, right] = this.fighters;
    const a = left.state, b = right.state;
    const dx = b.x - a.x, dy = b.y - a.y;
    const distance = Math.hypot(dx, dy);
    const minimum = a.radius + b.radius;
    if (distance > minimum + CONTACT_RELEASE_GAP) this.touching = false;
    if (distance > minimum) return;

    const nx = distance > EPSILON ? dx / distance : 1;
    const ny = distance > EPSILON ? dy / distance : 0;
    const stunnedA = a.world.stunnedUntilMs > this.elapsedMs, stunnedB = b.world.stunnedUntilMs > this.elapsedMs;
    const relative = ((stunnedB ? 0 : b.vx) - (stunnedA ? 0 : a.vx)) * nx + ((stunnedB ? 0 : b.vy) - (stunnedA ? 0 : a.vy)) * ny;
    this.separate(a, b, nx, ny, minimum - distance + EPSILON);
    // Flight has no impact damage. A grapple fixes both positions; touching
    // throughout its three ticks must never manufacture additional contacts.
    if (a.cheng?.dash || b.cheng?.dash || a.boundUntilMs >= this.elapsedMs || b.boundUntilMs >= this.elapsedMs) {
      this.touching = true;
      return;
    }
    if (relative < 0) {
      // Equal-mass elastic normal impulse; normalize afterwards so these
      // arcade balls retain their configured movement speed after glancing hits.
      if (!stunnedA) { a.vx += relative * nx * (stunnedB ? 2 : 1); a.vy += relative * ny * (stunnedB ? 2 : 1); this.restoreSpeed(left, -nx, -ny); }
      if (!stunnedB) { b.vx -= relative * nx * (stunnedA ? 2 : 1); b.vy -= relative * ny * (stunnedA ? 2 : 1); this.restoreSpeed(right, nx, ny); }
    }
    const newContact = !this.touching;
    this.touching = true;
    if (newContact && relative < 0) this.resolveContact(events);
  }

  private bounceWalls(fighter: Fighter, events: BattleEvent[]): void {
    const state = fighter.state;
    const minimum = state.radius, maximum = ARENA_SIZE - state.radius;
    let bounced = false;
    let wall: 'left' | 'right' | 'top' | 'bottom' = 'left';
    if (state.x < minimum) { state.x = minimum + (minimum - state.x); state.vx = Math.abs(state.vx); bounced = true; wall = 'left'; }
    else if (state.x > maximum) { state.x = maximum - (state.x - maximum); state.vx = -Math.abs(state.vx); bounced = true; wall = 'right'; }
    if (state.y < minimum) { state.y = minimum + (minimum - state.y); state.vy = Math.abs(state.vy); if (!bounced) wall = 'top'; bounced = true; }
    else if (state.y > maximum) { state.y = maximum - (state.y - maximum); state.vy = -Math.abs(state.vy); if (!bounced) wall = 'bottom'; bounced = true; }
    if (!bounced) return;
    state.wallBounces += 1; // A corner reflects two axes but is one wall contact.
    this.items.wallBounce(fighter, wall, events);
  }

  private restoreSpeed(fighter: ItemFighter, nx: number, ny: number): void {
    const speed = Math.hypot(fighter.state.vx, fighter.state.vy);
    const desired = this.items.speed(fighter);
    if (speed <= EPSILON) { fighter.state.vx = nx * desired; fighter.state.vy = ny * desired; }
    else { fighter.state.vx *= desired / speed; fighter.state.vy *= desired / speed; }
  }

  private separate(a: FighterState, b: FighterState, nx: number, ny: number, overlap: number): void {
    // Allocate the correction to available space. A ball pinned to an edge
    // transfers its share to the other ball instead of being pushed out of bounds.
    const available = (state: FighterState, ux: number, uy: number): number => state.world.stunnedUntilMs > this.elapsedMs ? 0 : Math.min(
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
    for (const fighter of this.fighters) {
      const liang = fighter.state.liang;
      if (!liang) continue;
      const quote = liang.phase === 'yield' ? LIANG_YIELD_QUOTES[Math.floor(fighter.random() * LIANG_YIELD_QUOTES.length)] : LIANG_RETURN_QUOTE;
      liang.contact = { phase: liang.phase, timeMs: this.elapsedMs, quote };
      this.emit(events, 'courtesy', fighter, fighter, 0, `${fighter.state.name}「${quote}」：${liang.phase === 'yield' ? '礼让，碰撞减伤' : '回礼，碰撞增伤'}`, liang.phase === 'yield' ? 'liang-yield' : 'liang-return');
    }
    const refunds = this.items.contact(events);
    // Capture both attacks before changing either HP. Lethal hits still trade.
    const attacks = [
      { source: left, target: right, damage: left.attack + this.items.collisionBonus(left), extra: left.state.world.stunnedUntilMs > this.elapsedMs ? 0 : this.items.extraHits(left) },
      { source: right, target: left, damage: right.attack + this.items.collisionBonus(right), extra: right.state.world.stunnedUntilMs > this.elapsedMs ? 0 : this.items.extraHits(right) },
    ];
    for (const { source, target, damage } of attacks) {
      if (source.state.world.stunnedUntilMs > this.elapsedMs) continue;
      this.damage(events, source, target, damage, 'attack', `${source.state.name} 碰撞`);
      source.state.hits += 1;
    }
    const extraCounts = new Map<ItemFighter, number>();
    for (let segment = 0; segment < Math.max(...attacks.map(attack => attack.extra)); segment++) {
      for (const attack of attacks) if (segment < attack.extra && attack.target.state.hp > 0) {
        this.damage(events, attack.source, attack.target, attack.damage, 'combo', `混元紫金棍第 ${segment + 1} 段追加伤害`, 'staff');
        extraCounts.set(attack.source, (extraCounts.get(attack.source) ?? 0) + 1);
      }
    }
    for (const [source, count] of extraCounts) this.emit(events, 'item', source, source, count, `${source.state.name} 混元紫金棍追加 ${count} 段伤害`, 'staff');
    for (const refund of refunds) this.damage(events, refund.source, refund.target, refund.amount, 'refund', '七天无理由退货成功', 'refund');
    // Keep both original phases throughout the complete exchange, including item callbacks.
    for (const { state } of this.fighters) if (state.liang) state.liang.phase = state.liang.phase === 'yield' ? 'return' : 'yield';
    for (const fighter of this.fighters) {
      const state = fighter.state;
      if (state.hp <= 0) continue;
      if (state.petId === 'hutao' && !state.nostalgiaUsed && state.hp <= HUTAO_NOSTALGIA_THRESHOLD) {
        state.nostalgiaUsed = true;
        this.heal(events, fighter, HUTAO_NOSTALGIA_HEAL, '忆往昔', 'nostalgia');
      }
    }
    if (this.fighters.some(fighter => fighter.state.hp <= 0)) this.finish(events, false);
  }

  private heal(events: BattleEvent[], fighter: ItemFighter, value: number, label: string, effect?: BattleEffect) {
    if (fighter.state.hp <= 0) return;
    const amount = Math.min(value, fighter.state.maxHp - fighter.state.hp);
    fighter.state.hp += amount;
    fighter.state.healing += amount;
    // A capped dice heal still announces its result and random quote.
    if (amount > 0 || fighter.state.petId === 'hutao') this.emit(events, 'heal', fighter, fighter, amount, `${fighter.state.name} ${label}，恢复 ${amount} 点生命`, effect);
  }

  private advanceHutao(events: BattleEvent[]) {
    for (const fighter of this.fighters) {
      if (fighter.state.petId !== 'hutao') continue;
      if (this.elapsedMs < BATTLE_LIMIT_MS && this.elapsedMs % HUTAO_ROLL_INTERVAL_MS === 0) {
        const value = 1 + Math.floor(fighter.random() * 6);
        fighter.state.diceRoll = { startedAtMs: this.elapsedMs, value, outcome: diceOutcome(value), quote: HUTAO_QUOTES[Math.floor(fighter.random() * HUTAO_QUOTES.length)], resolved: false };
        this.emit(events, 'roll', fighter, fighter, 0, `${fighter.state.name} 上嘴脸，开始投掷一枚六面骰子`);
      }
    }
    const due = this.fighters.filter(({ state }) => state.diceRoll && !state.diceRoll.resolved && this.elapsedMs >= state.diceRoll.startedAtMs + HUTAO_ROLL_DURATION_MS);
    // Same-tick rolls form one exchange: heal, self-cost, then both slaps before checking defeat.
    // Thus mirror slaps can trade lethally; neither seat wins by being processed first.
    for (const fighter of due) {
      const roll = fighter.state.diceRoll!;
      roll.resolved = true;
      const label = `上嘴脸 [${roll.value}点]「${roll.quote}」`;
      if (roll.outcome === 'heal') this.heal(events, fighter, HUTAO_DICE_HEAL, label);
      if (roll.outcome === 'self-damage') {
        this.damage(events, fighter, fighter, HUTAO_SELF_DAMAGE, 'self-damage', `${fighter.state.name} ${label}`);
      }
    }
    for (const fighter of due) {
      const roll = fighter.state.diceRoll!;
      if (roll.outcome !== 'slap') continue;
      const target = this.fighters.find(other => other !== fighter)!;
      this.damage(events, fighter, target, HUTAO_SLAP_DAMAGE, 'slap', `${fighter.state.name} 上嘴脸 [${roll.value}点]「${roll.quote}」，远程巴掌`);
    }
    if (due.length && this.fighters.some(({ state }) => state.hp <= 0)) this.finish(events, false);
  }

  /** Every damage source uses the same protection gate and effective statistics. */
  private damage(events: BattleEvent[], source: ItemFighter, target: ItemFighter, value: number, kind: DamageKind, label: string, effect?: BattleEffect, reflectable = true): number {
    const state = target.state;
    if (state.hp <= 0) return 0;
    // Deferred payments already include the original hit's bonus.
    if (source !== target && kind !== 'installment' && kind !== 'arena-damage') value += source.state.world.damageBonus;
    if (kind !== 'installment' && kind !== 'arena-damage') value += this.items.damageBonus(source);
    let prevented = 0;
    if (kind === 'attack') {
      if (source.state.liang?.phase === 'return') { value += LIANG_RETURN_BONUS; effect = 'liang-return'; }
      if (state.liang?.phase === 'yield') { prevented = Math.min(LIANG_REDUCTION, value); value = Math.max(0, value - LIANG_REDUCTION); }
    }
    const cheng = state.cheng;
    const immediate = this.items.splitDamage(source, target, value, kind);
    const jackpotImmune = this.elapsedMs < state.world.invulnerableUntilMs;
    if (jackpotImmune || (cheng && this.elapsedMs < cheng.invulnerableUntilMs)) {
      this.emit(events, 'immune', source, target, 0, `${state.name} 无敌，免疫${kind === 'drain' ? '汲取' : '伤害'}`, jackpotImmune ? 'lucky-jackpot' : 'survival');
      this.emit(events, kind, source, target, 0, `${label}，被 ${state.name} 免疫`, effect);
      return 0;
    }
    if (cheng && !cheng.survivalUsed && immediate >= state.hp) {
      cheng.survivalUsed = true;
      cheng.invulnerableUntilMs = this.elapsedMs + CHENG_INVULNERABLE_MS;
      this.emit(events, 'survive', target, target, 0, `${state.name}「${CHENG_QUOTES.survive}」：免疫此次致死伤害，保留 ${state.hp} 点生命，无敌 5 秒`, 'survival');
      this.emit(events, kind, source, target, 0, `${label}，被 ${state.name} 免疫`, effect);
      return 0;
    }
    const amount = Math.min(state.hp, immediate);
    if (prevented > 0) this.emit(events, 'courtesy', target, target, prevented, `${state.name} 礼让减免 ${prevented} 点碰撞伤害`, 'liang-yield');
    state.hp -= amount;
    if (source !== target) source.state.damageDealt += amount;
    this.emit(events, kind, source, target, amount, kind === 'self-damage' ? `${label}，自损 ${amount} 点生命` : `${label}，对 ${state.name} 造成 ${amount} 点伤害`, effect);
    this.unlockGrapple(events, target);
    const canReflect = reflectable && kind !== 'reflection';
    if (state.hp > 0) this.items.deferDamage(events, source, target, value - immediate, canReflect);
    this.items.afterDamage(events, source, target, amount, kind, canReflect);
    return amount;
  }

  private unlockGrapple(events: BattleEvent[], fighter: ItemFighter) {
    const { cheng, hp } = fighter.state;
    if (!cheng || cheng.grappleUnlocked || hp <= 0 || hp > CHENG_GRAPPLE_THRESHOLD) return;
    cheng.grappleUnlocked = true;
    this.emit(events, 'awaken', fighter, fighter, 0, `${fighter.state.name} 急眼了，永久解锁「我跟你爆了」`);
  }

  private dashDestination(source: FighterState, target: FighterState) {
    const start = Math.atan2(source.y - target.y, source.x - target.x);
    const gap = source.radius + target.radius + 2;
    // Prefer the approaching side, then rotate inward when the target is at an edge.
    for (let i = 0; i < 32; i++) {
      const angle = start + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * Math.PI / 16;
      const x = target.x + Math.cos(angle) * gap, y = target.y + Math.sin(angle) * gap;
      if (x >= source.radius && x <= ARENA_SIZE - source.radius && y >= source.radius && y <= ARENA_SIZE - source.radius) return { x, y };
    }
    throw new Error('场内没有合法的束缚落点。');
  }

  private advanceDashes(events: BattleEvent[]) {
    const flying = this.fighters.filter(fighter => fighter.state.cheng?.dash && fighter.state.boundUntilMs < this.elapsedMs && fighter.state.world.stunnedUntilMs <= this.elapsedMs);
    // Compute every destination before moving either ball, including mirror dashes.
    const moves = flying.map(fighter => {
      const dash = fighter.state.cheng!.dash!;
      const target = this.fighters.find(other => other.state.id === dash.targetId)!;
      const destination = dash.paired ? { x: dash.toX, y: dash.toY } : this.dashDestination(fighter.state, target.state);
      const progress = Math.min(1, (this.elapsedMs - dash.startedAtMs) / CHENG_DASH_DURATION_MS);
      return { fighter, target, progress, x: dash.fromX + (destination.x - dash.fromX) * progress, y: dash.fromY + (destination.y - dash.fromY) * progress };
    });
    for (const move of moves) Object.assign(move.fighter.state, { x: move.x, y: move.y });
    for (const { fighter, target, progress } of moves) {
      if (progress < 1) continue;
      fighter.state.cheng!.dash = null;
      fighter.state.cheng!.grapple = { targetId: target.state.id, startedAtMs: this.elapsedMs, ticks: 0 };
      fighter.state.boundUntilMs = Math.max(fighter.state.boundUntilMs, this.elapsedMs + CHENG_BIND_DURATION_MS);
      target.state.boundUntilMs = Math.max(target.state.boundUntilMs, this.elapsedMs + CHENG_BIND_DURATION_MS);
      this.emit(events, 'bind', fighter, target, 0, `${fighter.state.name}「${CHENG_QUOTES.bind}」：双方束缚 3 秒，均不能移动`);
    }
  }

  private advanceCheng(events: BattleEvent[]) {
    for (const fighter of this.fighters) {
      const cheng = fighter.state.cheng;
      if (!cheng || fighter.state.hp <= 0) continue;
      this.unlockGrapple(events, fighter);
      if (cheng.mealStartedAtMs !== null && this.elapsedMs >= cheng.mealStartedAtMs + CHENG_MEAL_DURATION_MS) {
        cheng.mealStartedAtMs = null;
        cheng.meals++;
        this.heal(events, fighter, CHENG_MEAL_HEAL, '一天八顿', 'meal');
      }
    }
    // Capture all due drains before applying damage, so simultaneous mirror
    // drains trade fairly. A dead source never heals back to life afterwards.
    const drains = this.fighters.filter(({ state }) => state.cheng?.grapple && this.elapsedMs >= state.cheng.grapple.startedAtMs + (state.cheng.grapple.ticks + 1) * CHENG_DRAIN_INTERVAL_MS).map(source => {
      const grapple = source.state.cheng!.grapple!;
      grapple.ticks++;
      return { source, target: this.fighters.find(other => other.state.id === grapple.targetId)!, amount: 0 };
    });
    for (const drain of drains) drain.amount = this.damage(events, drain.source, drain.target, CHENG_DRAIN_DAMAGE, 'drain', `${drain.source.state.name} 兄弟汲取`, 'drain');
    for (const drain of drains) if (drain.amount > 0) this.heal(events, drain.source, drain.amount, '兄弟汲取', 'drain');
    for (const fighter of this.fighters) {
      const grapple = fighter.state.cheng?.grapple;
      if (grapple && this.elapsedMs >= grapple.startedAtMs + CHENG_BIND_DURATION_MS) {
        fighter.state.cheng!.grapple = null;
        this.emit(events, 'release', fighter, this.fighters.find(other => other.state.id === grapple.targetId)!, 0, `${fighter.state.name} 松开兄弟，双方恢复移动`);
      }
    }
    for (const fighter of this.fighters) fighter.state.boundUntilMs = 0;
    for (const { state } of this.fighters) {
      const grapple = state.cheng?.grapple;
      if (!grapple) continue;
      const target = this.fighters.find(other => other.state.id === grapple.targetId)!;
      state.boundUntilMs = Math.max(state.boundUntilMs, grapple.startedAtMs + CHENG_BIND_DURATION_MS);
      target.state.boundUntilMs = Math.max(target.state.boundUntilMs, grapple.startedAtMs + CHENG_BIND_DURATION_MS);
    }
    if (this.fighters.some(({ state }) => state.hp <= 0)) { this.finish(events, false); return; }
    const ready = this.fighters.filter(({ state }) => state.cheng?.grappleUnlocked && !state.cheng.dash && !state.cheng.grapple && !state.boundUntilMs && state.world.stunnedUntilMs <= this.elapsedMs && this.elapsedMs >= state.cheng.nextGrappleAtMs);
    const paired = ready.length === 2;
    const midpoint = { x: (this.fighters[0].state.x + this.fighters[1].state.x) / 2, y: (this.fighters[0].state.y + this.fighters[1].state.y) / 2 };
    if (paired) {
      const angle = Math.atan2(this.fighters[0].state.y - this.fighters[1].state.y, this.fighters[0].state.x - this.fighters[1].state.x);
      const halfGap = (this.fighters[0].state.radius + this.fighters[1].state.radius + 2) / 2;
      const outerRadius = Math.max(this.fighters[0].state.radius, this.fighters[1].state.radius);
      const marginX = outerRadius + Math.abs(Math.cos(angle)) * halfGap;
      const marginY = outerRadius + Math.abs(Math.sin(angle)) * halfGap;
      midpoint.x = Math.max(marginX, Math.min(ARENA_SIZE - marginX, midpoint.x));
      midpoint.y = Math.max(marginY, Math.min(ARENA_SIZE - marginY, midpoint.y));
    }
    for (const fighter of ready) {
      const state = fighter.state, cheng = state.cheng!;
      const enemies = this.fighters.filter(other => other !== fighter && other.state.hp > 0);
      const target = enemies[Math.floor(fighter.random() * enemies.length)];
      const destination = paired ? { x: (state.x + midpoint.x) / 2, y: (state.y + midpoint.y) / 2 } : this.dashDestination(state, target.state);
      if (paired) {
        const angle = Math.atan2(state.y - target.state.y, state.x - target.state.x);
        const halfGap = (state.radius + target.state.radius + 2) / 2;
        destination.x = midpoint.x + Math.cos(angle) * halfGap;
        destination.y = midpoint.y + Math.sin(angle) * halfGap;
      }
      cheng.dash = { targetId: target.state.id, startedAtMs: this.elapsedMs, fromX: state.x, fromY: state.y, toX: destination.x, toY: destination.y, paired };
      cheng.nextGrappleAtMs = this.elapsedMs + CHENG_GRAPPLE_COOLDOWN_MS;
      this.emit(events, 'dash', fighter, target, 0, `${state.name}「${CHENG_QUOTES.dash}」：快速飞向 ${target.state.name}`);
    }
    for (const fighter of this.fighters) {
      const { hp, cheng } = fighter.state;
      if (cheng && hp < CHENG_MEAL_THRESHOLD && cheng.mealStartedAtMs === null && this.elapsedMs >= cheng.nextMealAtMs && this.elapsedMs < BATTLE_LIMIT_MS) {
        cheng.mealStartedAtMs = this.elapsedMs;
        cheng.nextMealAtMs = this.elapsedMs + CHENG_MEAL_COOLDOWN_MS;
        this.emit(events, 'meal', fighter, fighter, 0, `${fighter.state.name} 一天八顿，开始扒饭`);
      }
    }
  }

  private finish(events: BattleEvent[], timeout: boolean): void {
    this.finished = true;
    this.items.stop();
    this.world.stop();
    for (const { state } of this.fighters) {
      state.boundUntilMs = 0;
      if (state.cheng) { state.cheng.dash = null; state.cheng.grapple = null; state.cheng.mealStartedAtMs = null; state.cheng.invulnerableUntilMs = 0; }
    }
    const [left, right] = this.fighters;
    const difference = timeout ? left.state.hp * right.state.maxHp - right.state.hp * left.state.maxHp : left.state.hp - right.state.hp;
    this.draw = difference === 0;
    const winner = this.draw ? null : difference > 0 ? left : right;
    this.winnerId = winner?.state.id ?? null;
    this.emit(events, 'end', winner ?? left, winner ?? right, 0,
      this.draw ? (timeout ? '时间到，剩余生命比例相同，本局平局' : '双方同时倒下，本局平局')
        : timeout ? `时间到，${winner!.state.name} 以剩余生命比例获胜` : `${winner!.state.name} 赢得了本局对战`);
  }

  private emit(events: BattleEvent[], kind: BattleEvent['kind'], source: ItemFighter, target: ItemFighter, amount: number, text: string, effect?: BattleEffect): void {
    events.push({ seq: ++this.sequence, timeMs: this.elapsedMs, kind, sourceId: kind === 'arena-damage' || kind === 'world' ? '' : source.state.id, targetId: target.state.id, amount, text, x: target.state.x, y: target.state.y, ...(effect ? { effect } : {}) });
  }
}
