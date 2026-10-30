import { ARENA_SIZE, BATTLE_LIMIT_MS, SIMULATION_STEP_MS } from '../shared/catalog.js';
import { ITEM_RULES as R } from '../shared/items.js';
import type { BattleEffect, BattleEvent, DamageKind, FighterItemsState, FighterState, ItemFieldState, ItemId, RewindPosition } from '../shared/types.js';

export interface ItemFighter { state: FighterState; speed: number; baseRadius: number; itemRandom: () => number }
interface Hooks {
  damage(events: BattleEvent[], source: ItemFighter, target: ItemFighter, value: number, kind: DamageKind, label: string, effect?: BattleEffect, reflectable?: boolean): number;
  heal(events: BattleEvent[], target: ItemFighter, value: number, label: string, effect?: BattleEffect): void;
  emit(events: BattleEvent[], kind: BattleEvent['kind'], source: ItemFighter, target: ItemFighter, amount: number, text: string, effect?: BattleEffect): void;
}
type HistoryFrame = RewindPosition & { timeMs: number; hp: number };
const EPSILON = 0.000001;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function createItemState(equipped: ItemId[]): FighterItemsState {
  return {
    equipped: [...equipped], slipUntilMs: 0, pumpedUntilMs: 0,
    nextTeleportAtMs: R.toilet.intervalMs, teleportStartedAtMs: null,
    nextPumpAtMs: R.pump.intervalMs, nextPearlsAtMs: R.pearl.intervalMs,
    refundAmount: 0, refundExpiresAtMs: 0, nextRefundAtMs: 0,
    debts: [], rewindUsed: false, rewindPosition: null, positionRevision: 0,
    nextTicketAtMs: R.ticket.intervalMs, ticketRolls: 0, ticketWins: 0,
    staffAwakened: false, ascended: false, nextRegenAtMs: R.regen.intervalMs,
  };
}

/** Item rules own field objects and clocks; all damage still uses the battle's protection gate. */
export class BattleItems {
  private field: ItemFieldState = { bananas: [], punches: [], pearls: [], bombs: [] };
  private history = new Map<string, HistoryFrame[]>();
  private nextId = 0;
  private now = 0;

  constructor(private fighters: ItemFighter[], private hooks: Hooks) {
    for (const fighter of fighters) {
      if (this.has(fighter, 'plain-club')) fighter.state.items.staffAwakened = fighter.itemRandom() < R.staff.awakenChance;
      this.normalize(fighter);
      if (this.has(fighter, 'rewind-tape')) this.history.set(fighter.state.id, []);
      if (this.has(fighter, 'bomb-parcel')) this.field.bombs.push({ id: ++this.nextId, ownerId: fighter.state.id, holderId: fighter.state.id, explodesAtMs: R.bomb.fuseMs });
    }
    this.recordHistory();
  }

  snapshot(): ItemFieldState { return structuredClone(this.field); }
  private has(fighter: ItemFighter, id: ItemId) { return fighter.state.items.equipped.includes(id); }
  private mobile(fighter: ItemFighter) { return fighter.state.hp > 0 && fighter.state.world.stunnedUntilMs <= this.now && (!fighter.state.boundUntilMs || fighter.state.boundUntilMs < this.now) && !fighter.state.cheng?.dash; }

  speed(fighter: ItemFighter) {
    const items = fighter.state.items;
    return fighter.speed * (items.slipUntilMs > this.now ? R.banana.speedMultiplier : 1) * (items.pumpedUntilMs > this.now ? R.pump.speedMultiplier : 1)
      * (this.has(fighter, 'thorn-armor') ? R.thorns.speedMultiplier : 1) * (items.ascended ? R.ascension.speedMultiplier : 1);
  }

  collisionBonus(fighter: ItemFighter) { return this.has(fighter, 'plain-club') ? R.staff.collisionBonus : 0; }
  extraHits(fighter: ItemFighter) { return fighter.state.items.staffAwakened ? 1 + Math.floor(fighter.itemRandom() * R.staff.maxExtraHits) : 0; }
  damageBonus(fighter: ItemFighter) { return fighter.state.items.ascended ? R.ascension.damageBonus : 0; }

  private normalize(fighter: ItemFighter) {
    const magnitude = Math.hypot(fighter.state.vx, fighter.state.vy);
    if (magnitude > EPSILON) {
      const scale = this.speed(fighter) / magnitude;
      fighter.state.vx *= scale; fighter.state.vy *= scale;
    }
  }

  /** Relocation moves only the requested ball, so a bound opponent is never pushed aside. */
  private relocate(fighter: ItemFighter, position: RewindPosition) {
    const state = fighter.state;
    let x = clamp(position.x, state.radius, ARENA_SIZE - state.radius);
    let y = clamp(position.y, state.radius, ARENA_SIZE - state.radius);
    const other = this.fighters.find(enemy => enemy !== fighter)!.state;
    const gap = state.radius + other.radius + 1;
    if (Math.hypot(x - other.x, y - other.y) < gap) {
      const candidates: { x: number; y: number }[] = [];
      for (let step = 0; step < 64; step++) {
        const angle = step * Math.PI / 32;
        const candidate = { x: other.x + Math.cos(angle) * gap, y: other.y + Math.sin(angle) * gap };
        if (candidate.x >= state.radius && candidate.x <= ARENA_SIZE - state.radius && candidate.y >= state.radius && candidate.y <= ARENA_SIZE - state.radius) candidates.push(candidate);
      }
      candidates.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
      if (candidates[0]) { x = candidates[0].x; y = candidates[0].y; }
    }
    Object.assign(state, { x, y, vx: position.vx, vy: position.vy });
    this.normalize(fighter);
    state.items.positionRevision++;
  }

  prepareStep(now: number, events: BattleEvent[]) {
    this.now = now;
    this.field.bananas = this.field.bananas.filter(peel => peel.expiresAtMs > now);
    this.field.pearls = this.field.pearls.filter(pearl => pearl.expiresAtMs > now);
    for (const fighter of this.fighters) {
      const state = fighter.state, items = state.items;
      if (items.slipUntilMs && now >= items.slipUntilMs) { items.slipUntilMs = 0; this.normalize(fighter); }
      if (items.pumpedUntilMs && now >= items.pumpedUntilMs) {
        items.pumpedUntilMs = 0; state.radius = fighter.baseRadius; this.normalize(fighter);
        this.hooks.emit(events, 'item', fighter, fighter, 0, `${state.name} 充气结束，恢复原本体型`, 'pump');
      }
      if (items.refundAmount && now >= items.refundExpiresAtMs) items.refundAmount = 0;
      if (items.rewindPosition && this.mobile(fighter)) { this.relocate(fighter, items.rewindPosition); items.rewindPosition = null; }
      if (now >= BATTLE_LIMIT_MS || state.hp <= 0) continue;
      if (now === SIMULATION_STEP_MS && items.staffAwakened) this.hooks.emit(events, 'item', fighter, fighter, 0, `${state.name} 的大棒升华成混元紫金棍！`, 'staff');
      if (this.has(fighter, 'ascension-charm') && !items.ascended && now >= R.ascension.atMs) {
        items.ascended = true; state.maxHp *= R.ascension.hpMultiplier; this.normalize(fighter);
        this.hooks.emit(events, 'item', fighter, fighter, 0, `${state.name} 飞升！生命上限 +50%、移速 +50%、所有伤害 +2`, 'ascension');
        this.hooks.heal(events, fighter, state.maxHp, '飞升回满生命', 'ascension');
      }
      if (this.has(fighter, 'overinflator') && now >= items.nextPumpAtMs && this.mobile(fighter)) {
        state.radius = fighter.baseRadius * R.pump.radiusMultiplier;
        items.pumpedUntilMs = now + R.pump.durationMs;
        items.nextPumpAtMs = now + R.pump.intervalMs;
        this.relocate(fighter, state); this.normalize(fighter);
        this.hooks.emit(events, 'item', fighter, fighter, 0, `${state.name} 过度充气，体型增大、速度降低`, 'pump');
      }
      if (this.has(fighter, 'emergency-toilet') && now >= items.nextTeleportAtMs && items.teleportStartedAtMs === null) {
        items.teleportStartedAtMs = now; items.nextTeleportAtMs = now + R.toilet.intervalMs;
        this.hooks.emit(events, 'item', fighter, fighter, 0, `${state.name} 马桶就绪，即将冲走`, 'toilet');
      }
      if (this.has(fighter, 'pearl-cup') && now >= items.nextPearlsAtMs) {
        items.nextPearlsAtMs = now + R.pearl.intervalMs;
        for (let i = 0; i < R.pearl.count; i++) {
          const margin = R.pearl.radius + 5;
          this.field.pearls.push({ id: ++this.nextId, ownerId: state.id, x: margin + fighter.itemRandom() * (ARENA_SIZE - margin * 2), y: margin + fighter.itemRandom() * (ARENA_SIZE - margin * 2), expiresAtMs: now + R.pearl.lifetimeMs });
        }
        this.hooks.emit(events, 'item', fighter, fighter, 0, `${state.name} 奶茶洒出 3 颗珍珠，双方都能拾取`, 'pearl');
      }
    }
  }

  wallBounce(fighter: ItemFighter, wall: 'left' | 'right' | 'top' | 'bottom', events: BattleEvent[]) {
    const state = fighter.state;
    if (this.has(fighter, 'banana-peel') && state.wallBounces % R.banana.bounces === 0) {
      this.field.bananas.push({ id: ++this.nextId, ownerId: state.id, x: state.x, y: state.y, expiresAtMs: this.now + R.banana.lifetimeMs, armed: false });
      this.hooks.emit(events, 'item', fighter, fighter, 0, `${state.name} 留下一块香蕉皮，存在 20 秒`, 'banana');
    }
    if (this.has(fighter, 'wall-punch') && state.wallBounces % R.punch.bounces === 0) {
      const dx = wall === 'left' ? 1 : wall === 'right' ? -1 : 0;
      const dy = wall === 'top' ? 1 : wall === 'bottom' ? -1 : 0;
      const x = dx ? (dx > 0 ? R.punch.radius : ARENA_SIZE - R.punch.radius) : state.x;
      const y = dy ? (dy > 0 ? R.punch.radius : ARENA_SIZE - R.punch.radius) : state.y;
      this.field.punches.push({ id: ++this.nextId, ownerId: state.id, x, y, originX: x, originY: y, dx, dy, launchAtMs: this.now + R.punch.warningMs });
      this.hooks.emit(events, 'item', fighter, fighter, 0, `${state.name} 在墙里装了拳套，0.7 秒后出拳`, 'punch');
    }
  }

  /** Snapshot old barcodes before this contact's damage creates any new ones. */
  contact(events: BattleEvent[]) {
    const refunds: { source: ItemFighter; target: ItemFighter; amount: number }[] = [];
    for (const bomb of this.field.bombs) {
      const old = this.fighters.find(f => f.state.id === bomb.holderId)!;
      const next = this.fighters.find(f => f !== old)!;
      bomb.holderId = next.state.id;
      this.hooks.emit(events, 'item', old, next, 0, `${old.state.name} 把炸弹快递塞给 ${next.state.name}，倒计时不变`, 'bomb');
    }
    for (const source of this.fighters) {
      const items = source.state.items;
      if (items.refundAmount > 0 && this.now < items.refundExpiresAtMs) {
        refunds.push({ source, target: this.fighters.find(f => f !== source)!, amount: items.refundAmount });
        items.refundAmount = 0;
      }
    }
    return refunds;
  }

  splitDamage(source: ItemFighter, target: ItemFighter, value: number, kind: DamageKind) {
    return source !== target && kind !== 'installment' && this.has(target, 'pain-installment') ? Math.ceil(value / 2) : value;
  }

  deferDamage(events: BattleEvent[], source: ItemFighter, target: ItemFighter, value: number, reflectable: boolean) {
    if (value <= 0) return;
    target.state.items.debts.push({ sourceId: source.state.id, remaining: value, ticksLeft: R.installment.ticks, nextAtMs: this.now + R.installment.intervalMs, reflectable });
    this.hooks.emit(events, 'item', source, target, value, `${target.state.name} 伤害分期，剩余 ${value} 点分 4 期支付`, 'installment');
  }

  afterDamage(events: BattleEvent[], source: ItemFighter, target: ItemFighter, amount: number, kind: DamageKind, reflectable = true) {
    if (amount <= 0) return;
    const state = target.state, items = state.items;
    if (state.hp > 0 && source !== target && !['refund', 'installment', 'reflection'].includes(kind) && this.has(target, 'refund-code') && this.now >= items.nextRefundAtMs) {
      items.refundAmount = amount; items.refundExpiresAtMs = this.now + R.refund.windowMs; items.nextRefundAtMs = this.now + R.refund.cooldownMs;
      this.hooks.emit(events, 'item', target, target, 0, `${state.name} 打印退货码：${amount} 点，3 秒内碰撞退回`, 'refund');
    }
    this.rewindAfterDamage(events, target);
    if (reflectable && kind !== 'reflection' && kind !== 'arena-damage' && this.has(target, 'thorn-armor')) {
      this.hooks.damage(events, target, source, R.thorns.damage, 'reflection', `${state.name} 反伤刺甲`, 'thorns', false);
    }
  }

  private rewindAfterDamage(events: BattleEvent[], target: ItemFighter) {
    const state = target.state, items = state.items;
    if (state.hp <= 0 || state.hp >= R.rewind.threshold || items.rewindUsed || !this.has(target, 'rewind-tape')) return;
    const frames = this.history.get(state.id)!;
    let frame = frames[0];
    for (const record of frames) if (record.timeMs <= this.now - R.rewind.historyMs) frame = record; else break;
    items.rewindUsed = true;
    const change = clamp(frame.hp, 1, state.maxHp) - state.hp;
    state.hp += change;
    if (change > 0) state.healing += change;
    const position = { x: frame.x, y: frame.y, vx: frame.vx, vy: frame.vy };
    if (this.mobile(target)) this.relocate(target, position); else items.rewindPosition = position;
    this.hooks.emit(events, 'rewind', target, target, change, `${state.name} 后悔药倒带：生命恢复到 ${state.hp}，位置与方向回到 3 秒前；次数与欠款不回退`, 'rewind');
  }

  advance(events: BattleEvent[]) {
    for (const fighter of this.fighters) {
      const items = fighter.state.items;
      if (fighter.state.hp > 0 && this.now <= BATTLE_LIMIT_MS) {
        if (this.has(fighter, 'lucky-ticket') && this.now >= items.nextTicketAtMs) {
          items.nextTicketAtMs += R.ticket.intervalMs; items.ticketRolls++;
          const won = fighter.itemRandom() < R.ticket.winChance;
          if (won) { items.ticketWins++; this.hooks.heal(events, fighter, fighter.state.maxHp, '好运奖券中奖，恢复满血', 'lucky-ticket'); }
          this.hooks.emit(events, 'item', fighter, fighter, 0, `${fighter.state.name} 好运奖券：${won ? '中奖，恢复满血！' : '烟花很好看，下次一定中'}`, 'lucky-ticket');
        }
        if (this.has(fighter, 'healing-orb') && this.now >= items.nextRegenAtMs) {
          items.nextRegenAtMs += R.regen.intervalMs;
          this.hooks.heal(events, fighter, R.regen.heal, '回血宝珠', 'regen');
        }
      }
      if (items.teleportStartedAtMs !== null && this.now >= items.teleportStartedAtMs + R.toilet.warningMs && this.mobile(fighter)) {
        const corner = Math.floor(fighter.itemRandom() * 4);
        const dx = corner % 2 ? -1 : 1, dy = corner >= 2 ? -1 : 1;
        const inset = fighter.state.radius + 4;
        this.relocate(fighter, { x: dx > 0 ? inset : ARENA_SIZE - inset, y: dy > 0 ? inset : ARENA_SIZE - inset, vx: dx, vy: dy });
        items.teleportStartedAtMs = null;
        this.hooks.emit(events, 'item', fighter, fighter, 0, `${fighter.state.name} 被马桶冲到了${dy > 0 ? '上' : '下'}${dx > 0 ? '左' : '右'}角`, 'toilet');
      }
    }
    this.advanceBananas(events);
    this.advancePearls(events);
    this.advancePunches(events);
    // Capture and remove due obligations before applying any damage. A rewind
    // cannot undo an already charged installment or reset a bomb fuse.
    const payments = this.fighters.flatMap(target => target.state.items.debts.filter(debt => this.now >= debt.nextAtMs).map(debt => {
      const amount = Math.min(debt.remaining, Math.ceil(debt.remaining / debt.ticksLeft));
      debt.remaining -= amount; debt.ticksLeft--; debt.nextAtMs += R.installment.intervalMs;
      return { source: this.fighters.find(f => f.state.id === debt.sourceId)!, target, amount, reflectable: debt.reflectable };
    }));
    for (const fighter of this.fighters) fighter.state.items.debts = fighter.state.items.debts.filter(debt => debt.remaining > 0 && debt.ticksLeft > 0);
    for (const payment of payments) this.hooks.damage(events, payment.source, payment.target, payment.amount, 'installment', `${payment.target.state.name} 本期扣款`, 'installment', payment.reflectable);
    const bombs = this.field.bombs.filter(bomb => this.now >= bomb.explodesAtMs);
    this.field.bombs = this.field.bombs.filter(bomb => this.now < bomb.explodesAtMs);
    for (const bomb of bombs) {
      const owner = this.fighters.find(f => f.state.id === bomb.ownerId)!;
      const holder = this.fighters.find(f => f.state.id === bomb.holderId)!;
      this.hooks.emit(events, 'item', owner, holder, 0, `${holder.state.name} 签收炸弹快递，爆炸！`, 'bomb');
      this.hooks.damage(events, owner, holder, R.bomb.damage, 'item-damage', '到付炸弹爆炸', 'bomb');
    }
  }

  private advanceBananas(events: BattleEvent[]) {
    this.field.bananas = this.field.bananas.filter(peel => {
      const owner = this.fighters.find(f => f.state.id === peel.ownerId)!;
      if (!peel.armed) peel.armed = Math.hypot(owner.state.x - peel.x, owner.state.y - peel.y) > owner.state.radius + R.banana.radius;
      if (!peel.armed) return true;
      const target = this.fighters.filter(f => f.state.hp > 0 && !f.state.cheng?.dash && Math.hypot(f.state.x - peel.x, f.state.y - peel.y) <= f.state.radius + R.banana.radius).sort((a, b) => Math.hypot(a.state.x - peel.x, a.state.y - peel.y) - Math.hypot(b.state.x - peel.x, b.state.y - peel.y))[0];
      if (!target) return true;
      target.state.items.slipUntilMs = this.now + R.banana.slipMs; this.normalize(target);
      this.hooks.emit(events, 'item', owner, target, 0, `${target.state.name} 踩到${owner === target ? '自己扔的' : ''}香蕉皮：谁扔的？！`, 'banana');
      return false;
    });
  }

  private advancePearls(events: BattleEvent[]) {
    this.field.pearls = this.field.pearls.filter(pearl => {
      const owner = this.fighters.find(f => f.state.id === pearl.ownerId)!;
      const candidates = this.fighters.filter(f => f.state.hp > 0 && f.state.hp < f.state.maxHp && !f.state.cheng?.dash && Math.hypot(f.state.x - pearl.x, f.state.y - pearl.y) <= f.state.radius + R.pearl.radius);
      if (!candidates.length) return true;
      candidates.sort((a, b) => Math.hypot(a.state.x - pearl.x, a.state.y - pearl.y) - Math.hypot(b.state.x - pearl.x, b.state.y - pearl.y));
      const tied = candidates.length === 2 && Math.abs(Math.hypot(candidates[0].state.x - pearl.x, candidates[0].state.y - pearl.y) - Math.hypot(candidates[1].state.x - pearl.x, candidates[1].state.y - pearl.y)) < EPSILON;
      const target = tied ? candidates[Math.floor(owner.itemRandom() * 2)] : candidates[0];
      this.hooks.heal(events, target, target.state.maxHp * R.pearl.healRatio, '喝到奶茶珍珠', 'pearl');
      return false;
    });
  }

  private advancePunches(events: BattleEvent[]) {
    const hits: { source: ItemFighter; target: ItemFighter; dx: number; dy: number }[] = [];
    this.field.punches = this.field.punches.filter(punch => {
      if (this.now < punch.launchAtMs) return true;
      const step = R.punch.speed * SIMULATION_STEP_MS / 1000;
      const endX = punch.x + punch.dx * step, endY = punch.y + punch.dy * step;
      // Swept circle contact finds the first ball along this short segment.
      const candidates = this.fighters.filter(f => f.state.hp > 0).flatMap(target => {
        const ox = punch.x - target.state.x, oy = punch.y - target.state.y;
        const radius = R.punch.radius + target.state.radius;
        const along = ox * punch.dx + oy * punch.dy;
        const discriminant = along * along - (ox * ox + oy * oy - radius * radius);
        if (discriminant < 0) return [];
        const distance = Math.max(0, -along - Math.sqrt(discriminant));
        if (distance > step || (along > 0 && ox * ox + oy * oy > radius * radius)) return [];
        return [{ target, distance }];
      }).sort((a, b) => a.distance - b.distance);
      if (candidates[0]) {
        hits.push({ source: this.fighters.find(f => f.state.id === punch.ownerId)!, target: candidates[0].target, dx: punch.dx, dy: punch.dy });
        return false;
      }
      punch.x = endX; punch.y = endY;
      return endX >= -R.punch.radius && endX <= ARENA_SIZE + R.punch.radius && endY >= -R.punch.radius && endY <= ARENA_SIZE + R.punch.radius;
    });
    for (const hit of hits) {
      this.hooks.damage(events, hit.source, hit.target, R.punch.damage, 'item-damage', '墙里突然一拳', 'punch');
      if (this.mobile(hit.target)) this.relocate(hit.target, { x: hit.target.state.x + hit.dx * R.punch.knockback, y: hit.target.state.y + hit.dy * R.punch.knockback, vx: hit.dx, vy: hit.dy });
    }
  }

  recordHistory() {
    for (const { state } of this.fighters) {
      const frames = this.history.get(state.id);
      if (!frames) continue;
      frames.push({ timeMs: this.now, x: state.x, y: state.y, vx: state.vx, vy: state.vy, hp: state.hp });
      while (frames.length > 1 && frames[1].timeMs <= this.now - R.rewind.historyMs) frames.shift();
    }
  }

  stop() {
    this.field = { bananas: [], punches: [], pearls: [], bombs: [] };
    this.history.clear();
    for (const fighter of this.fighters) {
      const items = fighter.state.items;
      items.slipUntilMs = items.pumpedUntilMs = 0;
      items.teleportStartedAtMs = null; items.rewindPosition = null; items.debts = []; items.refundAmount = 0;
      fighter.state.radius = fighter.baseRadius; this.normalize(fighter);
    }
  }
}
