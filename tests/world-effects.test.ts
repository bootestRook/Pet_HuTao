import assert from 'node:assert/strict';
import test from 'node:test';
import { BattleSimulator } from '../server/battle.js';
import { ARENA_SIZE, BATTLE_LIMIT_MS, createDefaultLoadout } from '../shared/catalog.js';
import { WORLD_EFFECTS, WORLD_RULES as R } from '../shared/world-effects.js';
import type { BattleEvent, DamageKind, FighterState, PetId, WorldEffectId, WorldEffectState } from '../shared/types.js';

const players = (pets: PetId[] = ['liangchushuo', 'liangchushuo']) => ['a', 'b'].map((id, index) => ({ id, name: id, loadout: { ...createDefaultLoadout(), petId: pets[index] } }));
type InternalFighter = { state: FighterState };
type Internals = { fighters: InternalFighter[]; world: { state: WorldEffectState; random: () => number }; damage(events: BattleEvent[], source: InternalFighter, target: InternalFighter, value: number, kind: DamageKind, label: string): number };
function seedFor(id: WorldEffectId) {
  for (let seed = 0; seed < 100; seed++) if (new BattleSimulator(players(), seed).snapshot().world.id === id) return seed;
  throw new Error(`Missing seed for ${id}`);
}
function setup(id: WorldEffectId, pets?: PetId[]) {
  const battle = new BattleSimulator(players(pets), seedFor(id));
  const internal = battle as unknown as Internals;
  const [a, b] = internal.fighters.map(f => f.state);
  a.liang = b.liang = null; // Isolate item/world rules from character effects.
  Object.assign(a, { x: 80, y: 90, vx: 0, vy: 0 }); Object.assign(b, { x: 340, y: 330, vx: 0, vy: 0 });
  const damage = (value: number, kind: DamageKind = 'attack', target = 1, self = false) => {
    const events: BattleEvent[] = [];
    internal.damage(events, internal.fighters[self ? target : 1 - target], internal.fighters[target], value, kind, '测试伤害');
    return events;
  };
  return { battle, internal, a, b, damage };
}

test('each match chooses one of four seeded rules, independent of seats and network chunking', () => {
  const counts = new Map<WorldEffectId, number>();
  for (let seed = 0; seed < 400; seed++) {
    const battle = new BattleSimulator(players(), seed), reverse = new BattleSimulator(players().reverse(), seed);
    const world = battle.snapshot().world;
    assert.deepEqual(world, reverse.snapshot().world);
    assert.equal(world.nextAtMs, WORLD_EFFECTS.find(effect => effect.id === world.id)!.intervalMs);
    counts.set(world.id, (counts.get(world.id) ?? 0) + 1);
  }
  assert.equal(counts.size, 4);
  for (const count of counts.values()) assert.ok(count > 65 && count < 135);
  for (const rule of WORLD_EFFECTS) {
    const one = setup(rule.id), chunks = setup(rule.id);
    const expected = one.battle.advance(75_000), actual: BattleEvent[] = [];
    for (let time = 0; time < 75_000; time += 30) actual.push(...chunks.battle.advance(30));
    assert.deepEqual(actual, expected); assert.deepEqual(chunks.battle.snapshot(), one.battle.snapshot());
    const snapshot = one.battle.snapshot(); snapshot.world.debris.length = 0; snapshot.world.scaleRemainingMs = 99; snapshot.fighters[0].world.damageBonus = 99;
    assert.notEqual(one.battle.snapshot().world.scaleRemainingMs, 99); assert.notEqual(one.battle.snapshot().fighters[0].world.damageBonus, 99);
  }
});

test('divine scale freezes all combat clocks for exactly two seconds and conserves fractional HP', () => {
  const { battle, a, b } = setup('divine-scale'); a.hp = 20; b.hp = 81;
  assert.equal(battle.advance(34_990).some(e => e.kind === 'world'), false);
  assert.equal(battle.advance(10).filter(e => e.kind === 'world').length, 1);
  assert.equal(battle.snapshot().world.scaleRemainingMs, 2000);
  a.items.debts.push({ sourceId: 'b', remaining: 4, ticksLeft: 1, nextAtMs: 35_010, reflectable: true });
  a.world.invulnerableUntilMs = 36_000;
  const before = structuredClone([a, b]);
  assert.deepEqual(battle.advance(1990), []);
  assert.equal(battle.snapshot().elapsedMs, 35_000); assert.equal(battle.snapshot().world.scaleRemainingMs, 10);
  assert.deepEqual([a, b], before);
  const balanced = battle.advance(10);
  assert.deepEqual([a.hp, b.hp], [50.5, 50.5]); assert.equal(a.healing, 30.5); assert.equal(b.damageDealt, 0);
  assert.equal(balanced.find(e => e.kind === 'balance')?.amount, -30.5);
  assert.equal(battle.snapshot().elapsedMs, 35_000);
  battle.advance(10); assert.equal(battle.snapshot().elapsedMs, 35_010); assert.equal(a.hp, 50.5); assert.equal(a.items.debts.length, 0);
  battle.advance(34_990); assert.equal(battle.snapshot().world.scaleRemainingMs, 2000);
});

test('scale respects different maximum HP, does not treat redistribution as damage or revive a fallen ball', () => {
  const { battle, a, b } = setup('divine-scale', ['liangchushuo', 'chengzhiquan']);
  a.hp = 90; b.hp = 119;
  battle.advance(37_000);
  assert.deepEqual([a.hp, b.hp], [100, 109]); assert.equal(a.hp + b.hp, 209);
  assert.equal(b.cheng!.survivalUsed, false); assert.equal(b.damageDealt, 0); assert.equal(b.hp <= b.maxHp, true);
  const lethal = setup('divine-scale'); lethal.a.hp = 1;
  lethal.damage(2, 'attack', 0); lethal.battle.advance(10);
  assert.equal(lethal.a.hp, 0); assert.equal(lethal.battle.snapshot().finished, true);
});

test('five debris positions warn before landing; each hit deals three environmental damage and stuns for three seconds', () => {
  const { battle, internal, a, b } = setup('falling-junk');
  assert.equal(battle.advance(29_990).length, 0); battle.advance(10);
  const field = battle.snapshot().world.debris; assert.equal(field.length, 5);
  for (const junk of field) {
    assert.ok(junk.x >= R.junkRadius && junk.x <= ARENA_SIZE - R.junkRadius);
    assert.ok(junk.y >= R.junkRadius && junk.y <= ARENA_SIZE - R.junkRadius);
  }
  internal.world.state.debris.forEach((junk, index) => { junk.x = index === 0 ? a.x : 210; junk.y = index === 0 ? a.y : 210; });
  battle.advance(790); assert.equal(a.hp, 100); assert.equal(a.world.stunnedUntilMs, 0);
  const hit = battle.advance(10).find(e => e.kind === 'arena-damage')!;
  assert.equal(hit.amount, 3); assert.equal(hit.sourceId, ''); assert.equal(a.hp, 97); assert.equal(b.damageDealt, 0);
  assert.equal(a.world.stunnedUntilMs, 33_800);
  a.vx = 300; const x = a.x;
  battle.advance(2990); assert.equal(a.x, x); assert.equal(a.hp, 97); assert.equal(battle.snapshot().world.debris.length, 0);
  battle.advance(10); assert.ok(a.x > x); assert.equal(a.hits, 0);
});

test('stunned balls stay fixed when hit, cannot deal collision damage, and retain their hit counters', () => {
  const { battle, a, b } = setup('falling-junk');
  Object.assign(a, { x: 180, y: 210, vx: 300, vy: 0 }); a.world.stunnedUntilMs = 3000;
  Object.assign(b, { x: 246, y: 210, vx: -300, vy: 0 });
  const events = battle.advance(10);
  assert.equal(a.x, 180); assert.equal(a.hp, 90); assert.equal(b.hp, 100);
  assert.equal(a.hits, 0); assert.equal(b.hits, 1);
  assert.equal(events.filter(e => e.kind === 'attack').length, 1); assert.ok(b.vx > 0);
});

test('debris respects invulnerability but still stuns; simultaneous lethal debris finishes as a draw', () => {
  const immune = setup('falling-junk'); immune.battle.advance(30_000);
  immune.internal.world.state.debris.forEach((junk, index) => Object.assign(junk, { x: index === 0 ? immune.a.x : 210, y: index === 0 ? immune.a.y : 210 }));
  immune.a.world.invulnerableUntilMs = 50_000; immune.battle.advance(800);
  assert.equal(immune.a.hp, 100); assert.equal(immune.a.world.stunnedUntilMs, 33_800);
  const lethal = setup('falling-junk'); lethal.battle.advance(30_000); lethal.a.hp = lethal.b.hp = 3;
  lethal.internal.world.state.debris = [{ id: 1, x: lethal.a.x, y: lethal.a.y, landsAtMs: 30_800 }, { id: 2, x: lethal.b.x, y: lethal.b.y, landsAtMs: 30_800 }];
  const events = lethal.battle.advance(800);
  assert.equal(lethal.battle.snapshot().draw, true); assert.equal(events.filter(e => e.kind === 'arena-damage').length, 2);
  assert.equal(events.filter(e => e.kind === 'end').length, 1); assert.equal(lethal.battle.snapshot().world.debris.length, 0);
});

test('green meadow heals both living balls every sixty seconds, recording only effective healing', () => {
  const { battle, a, b } = setup('green-meadow'); a.hp = 60; b.hp = 95;
  battle.advance(59_990); assert.deepEqual([a.hp, b.hp], [60, 95]);
  const events = battle.advance(10); assert.deepEqual([a.hp, b.hp], [80, 100]); assert.deepEqual([a.healing, b.healing], [20, 5]);
  assert.equal(events.filter(e => e.kind === 'heal').length, 2);
  battle.advance(60_000); assert.deepEqual([a.hp, b.hp], [100, 100]); assert.deepEqual([a.healing, b.healing], [40, 5]);
  const boundary = setup('green-meadow'); boundary.a.hp = 5; boundary.b.hp = 80;
  boundary.battle.advance(BATTLE_LIMIT_MS - 10); assert.equal(boundary.a.hp, 85);
  const last = boundary.battle.advance(10);
  assert.equal(boundary.a.hp, 100); assert.equal(boundary.a.healing, 95);
  assert.equal(boundary.battle.snapshot().draw, true);
  assert.ok(last.findIndex(event => event.kind === 'heal') < last.findIndex(event => event.kind === 'end'));
});

test('unclaimed jackpot lasts exactly five seconds, returns at the next interval and never grants a reward on expiry', () => {
  const { battle, internal, a, b } = setup('lucky-jackpot');
  battle.advance(49_990); assert.equal(battle.snapshot().world.prize, null); battle.advance(10);
  internal.world.state.prize!.x = 210; internal.world.state.prize!.y = 210;
  battle.advance(4990); assert.ok(battle.snapshot().world.prize);
  battle.advance(10); assert.equal(battle.snapshot().world.prize, null); assert.equal(battle.snapshot().world.prizeWinnerId, null);
  battle.advance(45_000); assert.ok(battle.snapshot().world.prize); assert.equal(a.hp, 100); assert.equal(b.hp, 100);
});

for (const [index, reward] of ['invincible', 'heal', 'damage'].entries()) {
  test(`jackpot grants only the server-chosen ${reward} reward once per match`, () => {
    const { battle, internal, a, b, damage } = setup('lucky-jackpot');
    battle.advance(50_000); a.hp = 30;
    Object.assign(internal.world.state.prize!, { x: a.x, y: a.y });
    internal.world.random = () => (index + 0.5) / 3;
    const events = battle.advance(10), state = battle.snapshot().world;
    assert.equal(state.prizeWinnerId, a.id); assert.equal(state.prizeReward, reward); assert.equal(state.prize, null);
    assert.equal(events.filter(e => e.kind === 'reward').length, 1);
    if (reward === 'invincible') {
      assert.equal(a.world.invulnerableUntilMs, 70_010);
      assert.equal(damage(10, 'attack', 0).find(e => e.kind === 'attack')?.amount, 0);
      assert.equal(damage(10, 'self-damage', 0, true).find(e => e.kind === 'self-damage')?.amount, 0);
      battle.advance(19_990); assert.equal(a.hp, 30);
      battle.advance(10); damage(10, 'attack', 0); assert.equal(a.hp, 20);
    } else if (reward === 'heal') {
      assert.equal(a.hp, 80); assert.equal(a.healing, 50); assert.equal(a.world.damageBonus, 0);
    } else {
      assert.equal(a.world.damageBonus, 5); assert.equal(damage(10).find(e => e.kind === 'attack')?.amount, 15);
      assert.equal(damage(8, 'slap').find(e => e.kind === 'slap')?.amount, 13);
      assert.equal(damage(2, 'drain').find(e => e.kind === 'drain')?.amount, 7);
      assert.equal(damage(10, 'item-damage').find(e => e.kind === 'item-damage')?.amount, 15);
      assert.equal(damage(4, 'self-damage', 0, true).find(e => e.kind === 'self-damage')?.amount, 4);
      assert.equal(damage(3, 'arena-damage', 0, true).find(e => e.kind === 'arena-damage')?.amount, 3);
    }
    const later = battle.advance(100_000); assert.equal(later.filter(e => e.kind === 'reward').length, 0); assert.equal(battle.snapshot().world.prize, null);
    if (reward === 'damage') assert.equal(a.world.damageBonus, 5, 'damage reward lasts until the match ends');
    assert.equal(battle.snapshot().world.prizeWinnerId, 'a'); assert.ok(b.hp > 0);
  });
}

test('damage bonus is split into installments once, healing prize caps at max HP, and tied pickups use seeded randomness', () => {
  const bonus = setup('lucky-jackpot'); bonus.a.world.damageBonus = 5; bonus.b.items.equipped = ['pain-installment'];
  bonus.damage(10); assert.equal(bonus.b.hp, 92); assert.equal(bonus.b.items.debts[0].remaining, 7);
  bonus.battle.advance(4000); assert.equal(bonus.b.hp, 85); assert.equal(bonus.a.damageDealt, 15);
  const heal = setup('lucky-jackpot', ['chengzhiquan', 'liangchushuo']); heal.battle.advance(50_000); heal.a.hp = 100;
  Object.assign(heal.internal.world.state.prize!, { x: heal.a.x, y: heal.a.y }); heal.internal.world.random = () => 0.5;
  heal.battle.advance(10); assert.equal(heal.a.hp, 120); assert.equal(heal.a.healing, 20);
  const halfMax = setup('lucky-jackpot', ['chengzhiquan', 'liangchushuo']); halfMax.battle.advance(50_000); halfMax.a.hp = 40;
  Object.assign(halfMax.internal.world.state.prize!, { x: halfMax.a.x, y: halfMax.a.y }); halfMax.internal.world.random = () => 0.5;
  halfMax.battle.advance(10); assert.equal(halfMax.a.hp, 100); assert.equal(halfMax.a.healing, 60);
  for (const tieRoll of [0.1, 0.9]) {
    const tied = setup('lucky-jackpot'); tied.battle.advance(50_000);
    Object.assign(tied.a, { x: 175, y: 210 }); Object.assign(tied.b, { x: 245, y: 210 });
    Object.assign(tied.internal.world.state.prize!, { x: 210, y: 210 }); tied.internal.world.random = () => tieRoll;
    tied.battle.advance(10); assert.equal(tied.battle.snapshot().world.prizeWinnerId, tieRoll < 0.5 ? 'a' : 'b');
  }
});

test('timeout excludes scale pauses and finished matches cancel world objects and buffs', () => {
  const { battle } = setup('divine-scale');
  battle.advance(BATTLE_LIMIT_MS); assert.equal(battle.snapshot().finished, false);
  battle.advance(16_000); assert.equal(battle.snapshot().elapsedMs, BATTLE_LIMIT_MS); assert.equal(battle.snapshot().finished, true);
  assert.equal(battle.snapshot().world.scaleRemainingMs, 0); assert.deepEqual(battle.advance(10_000), []);
  const prize = setup('lucky-jackpot'); prize.battle.advance(50_000); prize.a.world.damageBonus = 5;
  prize.a.hp = 1; prize.damage(10, 'attack', 0); prize.battle.advance(10);
  assert.equal(prize.battle.snapshot().world.prize, null); assert.equal(prize.a.world.damageBonus, 0);
});
