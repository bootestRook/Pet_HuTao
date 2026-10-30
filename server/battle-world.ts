import { ARENA_SIZE, BATTLE_LIMIT_MS, SIMULATION_STEP_MS } from '../shared/catalog.js';
import { JACKPOT_LABELS, JACKPOT_REWARDS, WORLD_EFFECTS, WORLD_RULES as R } from '../shared/world-effects.js';
import type { BattleEffect, BattleEvent, DamageKind, WorldEffectState } from '../shared/types.js';
import type { ItemFighter } from './battle-items.js';

interface Hooks {
  damage(events: BattleEvent[], source: ItemFighter, target: ItemFighter, amount: number, kind: DamageKind, label: string, effect?: BattleEffect): number;
  heal(events: BattleEvent[], fighter: ItemFighter, amount: number, label: string, effect?: BattleEffect): void;
  emit(events: BattleEvent[], kind: BattleEvent['kind'], source: ItemFighter, target: ItemFighter, amount: number, label: string, effect?: BattleEffect): void;
}

/** One seeded battlefield rule per match. Clients only display this state. */
export class BattleWorld {
  private state: WorldEffectState;
  private nextId = 0;

  constructor(private fighters: ItemFighter[], private random: () => number, private hooks: Hooks) {
    const effect = WORLD_EFFECTS[Math.floor(random() * WORLD_EFFECTS.length)];
    this.state = { id: effect.id, nextAtMs: effect.intervalMs, scaleRemainingMs: 0, pulseAtMs: null, debris: [], prize: null, prizeWinnerId: null, prizeReward: null };
  }

  snapshot() { return structuredClone(this.state); }

  /** Pausing consumes wall time without advancing any combat clock or ability. */
  pauseStep(events: BattleEvent[]): boolean {
    if (!this.state.scaleRemainingMs) return false;
    this.state.scaleRemainingMs = Math.max(0, this.state.scaleRemainingMs - SIMULATION_STEP_MS);
    if (!this.state.scaleRemainingMs) this.equalize(events);
    return true;
  }

  private equalize(events: BattleEvent[]) {
    const living = this.fighters.filter(f => f.state.hp > 0).sort((a, b) => a.state.maxHp - b.state.maxHp);
    let remaining = living.reduce((sum, f) => sum + f.state.hp, 0);
    // Respect different HP caps while preserving the total current HP.
    const allocations = living.map((fighter, index) => {
      const hp = Math.min(fighter.state.maxHp, remaining / (living.length - index));
      remaining -= hp;
      return { fighter, hp };
    });
    for (const { fighter, hp } of allocations) {
      const change = hp - fighter.state.hp;
      if (change > 0) this.hooks.heal(events, fighter, change, '神之天平均分', 'divine-scale');
      else {
        fighter.state.hp = hp;
        this.hooks.emit(events, 'balance', fighter, fighter, change, `${fighter.state.name} 神之天平均分，生命变为 ${hp}`, 'divine-scale');
      }
    }
  }

  advance(now: number, events: BattleEvent[]) {
    const state = this.state;
    if ((now < BATTLE_LIMIT_MS || state.id === 'green-meadow') && now >= state.nextAtMs && !state.prizeWinnerId) {
      state.nextAtMs += WORLD_EFFECTS.find(effect => effect.id === state.id)!.intervalMs;
      const anchor = this.fighters[0];
      if (state.id === 'divine-scale') {
        state.scaleRemainingMs = R.scalePauseMs;
        this.hooks.emit(events, 'world', anchor, anchor, 0, '神之天平：战场暂停2秒，随后均分当前生命', state.id);
      } else if (state.id === 'falling-junk') {
        state.debris = Array.from({ length: R.junkCount }, () => ({ id: ++this.nextId, ...this.position(R.junkRadius), landsAtMs: now + R.junkWarningMs }));
        this.hooks.emit(events, 'world', anchor, anchor, 0, '天降厄运：5处落点预警，0.8秒后砸落', state.id);
      } else if (state.id === 'green-meadow') {
        state.pulseAtMs = now;
        this.hooks.emit(events, 'world', anchor, anchor, 0, '青青草原：所有存活小球恢复20点生命', state.id);
        for (const fighter of this.fighters) this.hooks.heal(events, fighter, R.meadowHeal, '青青草原', state.id);
      } else {
        state.prize = { ...this.position(R.prizeRadius), spawnedAtMs: now, expiresAtMs: now + R.prizeLifetimeMs };
        this.hooks.emit(events, 'world', anchor, anchor, 0, '幸运大奖出现：5秒内首次触碰者领取，本局只能领取一次', state.id);
      }
    }
    const falling = state.debris.filter(junk => now >= junk.landsAtMs && now - SIMULATION_STEP_MS < junk.landsAtMs);
    state.debris = state.debris.filter(junk => now < junk.landsAtMs + 500);
    // Capture all hits before applying them: both balls can be hit in the same step.
    const hits = falling.flatMap(junk => this.fighters.filter(f => f.state.hp > 0 && Math.hypot(f.state.x - junk.x, f.state.y - junk.y) <= f.state.radius + R.junkRadius));
    for (const fighter of hits) {
      this.hooks.damage(events, fighter, fighter, R.junkDamage, 'arena-damage', '天降厄运', 'falling-junk');
      if (fighter.state.hp <= 0) continue;
      fighter.state.world.stunnedUntilMs = now + R.stunMs;
      if (fighter.state.cheng) fighter.state.cheng.dash = null;
      this.hooks.emit(events, 'stun', fighter, fighter, 0, `${fighter.state.name} 被杂物砸中，眩晕3秒`, 'falling-junk');
    }
    if (state.prize && now >= state.prize.expiresAtMs) state.prize = null;
    if (!state.prize) return;
    const prize = state.prize;
    const candidates = this.fighters.filter(f => f.state.hp > 0 && Math.hypot(f.state.x - prize.x, f.state.y - prize.y) <= f.state.radius + R.prizeRadius)
      .map(fighter => ({ fighter, distance: Math.hypot(fighter.state.x - prize.x, fighter.state.y - prize.y) })).sort((a, b) => a.distance - b.distance);
    if (!candidates.length) return;
    const tied = candidates.length === 2 && Math.abs(candidates[0].distance - candidates[1].distance) < 0.000001;
    const winner = candidates[tied ? Math.floor(this.random() * 2) : 0].fighter;
    const reward = JACKPOT_REWARDS[Math.floor(this.random() * JACKPOT_REWARDS.length)];
    state.prize = null; state.prizeWinnerId = winner.state.id; state.prizeReward = reward;
    if (reward === 'invincible') winner.state.world.invulnerableUntilMs = now + R.invulnerableMs;
    if (reward === 'heal') this.hooks.heal(events, winner, winner.state.maxHp * R.prizeHealRatio, '幸运大奖', 'lucky-jackpot');
    if (reward === 'damage') winner.state.world.damageBonus = R.damageBonus;
    this.hooks.emit(events, 'reward', winner, winner, 0, `${winner.state.name} 领取幸运大奖：${JACKPOT_LABELS[reward]}${reward === 'damage' ? '，持续至本局结束' : ''}`, 'lucky-jackpot');
  }

  private position(radius: number) {
    const span = ARENA_SIZE - radius * 2;
    return { x: radius + this.random() * span, y: radius + this.random() * span };
  }

  stop() {
    this.state.scaleRemainingMs = 0; this.state.debris = []; this.state.prize = null; this.state.pulseAtMs = null;
    for (const { state } of this.fighters) state.world = { stunnedUntilMs: 0, invulnerableUntilMs: 0, damageBonus: 0 };
  }
}
