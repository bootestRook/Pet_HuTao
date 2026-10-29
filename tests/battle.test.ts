import assert from 'node:assert/strict';
import test from 'node:test';
import { BattleSimulator } from '../server/battle.js';
import { ARENA_SIZE, BATTLE_LIMIT_MS, CHARGE_PER_BOUNCE, HEAL_ON_CONTACT, MAX_CHARGE, PETS, SIMULATION_STEP_MS, createDefaultLoadout } from '../shared/catalog.js';
import type { BattleEvent, FighterState, PlayerInfo } from '../shared/types.js';

type Combatant = Pick<PlayerInfo, 'id' | 'name' | 'loadout'>;
const BALL_SPEED = PETS[0].speed;
const players = (): Combatant[] => [
  { id: 'alice', name: '蓄力球玩家', loadout: { ...createDefaultLoadout(), petId: 'charge' } },
  { id: 'bob', name: '回春球玩家', loadout: { ...createDefaultLoadout(), petId: 'renew' } },
];
// Only the tests reposition balls to reproduce exact contact geometries.
// Production has no position setters or client-supplied combat state.
function states(battle: BattleSimulator): FighterState[] {
  return (battle as unknown as { fighters: { state: FighterState }[] }).fighters.map(fighter => fighter.state);
}
function headOn(battle: BattleSimulator) {
  const [a, b] = states(battle);
  Object.assign(a, { x: ARENA_SIZE / 2 - a.radius - 1, y: ARENA_SIZE / 2, vx: BALL_SPEED, vy: 0 });
  Object.assign(b, { x: ARENA_SIZE / 2 + b.radius + 1, y: ARENA_SIZE / 2, vx: -BALL_SPEED, vy: 0 });
  return [a, b];
}
function assertBounds(fighter: FighterState) {
  assert.ok(Number.isFinite(fighter.x) && Number.isFinite(fighter.y));
  assert.ok(fighter.x >= fighter.radius - 1e-6 && fighter.x <= ARENA_SIZE - fighter.radius + 1e-6);
  assert.ok(fighter.y >= fighter.radius - 1e-6 && fighter.y <= ARENA_SIZE - fighter.radius + 1e-6);
  assert.ok(fighter.hp >= 0 && fighter.hp <= fighter.maxHp);
  assert.ok(fighter.charge >= 0 && fighter.charge <= MAX_CHARGE);
}

test('balls move immediately without timer damage, and snapshots do not expose mutable state', () => {
  const inputs = players();
  const battle = new BattleSimulator(inputs, 42);
  const initial = battle.snapshot();
  assert.equal(initial.elapsedMs, 0);
  assert.equal(initial.finished, false);
  assert.deepEqual(initial.fighters.map(f => f.hp), [100, 100]);
  assert.deepEqual(battle.advance(0), []);
  inputs[0].loadout.petId = 'renew';
  initial.fighters[0].hp = 0;
  initial.fighters[0].x = -1000;
  assert.equal(battle.snapshot().fighters[0].petId, 'charge');
  assert.equal(battle.snapshot().fighters[0].hp, 100);
  battle.advance(100);
  const moved = battle.snapshot();
  assert.ok(moved.fighters.every((fighter, index) => fighter.x !== initial.fighters[index].x));
  assert.deepEqual(moved.fighters.map(f => f.hp), [100, 100]);
  assert.equal(moved.elapsedMs, 100);
});

test('fixed steps retain sub-frame time and seeded results are independent of network chunk size', () => {
  const whole = new BattleSimulator(players(), 123456);
  const chunks = new BattleSimulator(players(), 123456);
  const expected = whole.advance(BATTLE_LIMIT_MS);
  const actual: BattleEvent[] = [];
  while (!chunks.snapshot().finished) actual.push(...chunks.advance(37));
  assert.deepEqual(actual, expected);
  assert.deepEqual(chunks.snapshot(), whole.snapshot());
  assert.deepEqual(expected.map(event => event.seq), expected.map((_, i) => i + 1));
  const fractional = new BattleSimulator(players(), 42);
  for (let i = 0; i < 100; i++) fractional.advance(0.1);
  const oneStep = new BattleSimulator(players(), 42);
  oneStep.advance(10);
  assert.deepEqual(fractional.snapshot(), oneStep.snapshot());
});

test('swapping input seats preserves positions, events and winner', () => {
  for (let seed = 0; seed < 30; seed++) {
    const input = players();
    const forward = new BattleSimulator(input, seed);
    const reverse = new BattleSimulator(input.reverse(), seed);
    assert.deepEqual(reverse.advance(BATTLE_LIMIT_MS), forward.advance(BATTLE_LIMIT_MS));
    assert.deepEqual(reverse.snapshot(), forward.snapshot());
  }
});

test('walls reflect velocity, a corner counts once, and charge caps without hurting either ball', () => {
  const battle = new BattleSimulator(players(), 1);
  const [a, b] = states(battle);
  Object.assign(b, { x: ARENA_SIZE * 0.75, y: ARENA_SIZE * 0.75, vx: 0, vy: 0 });
  for (let i = 0; i < 5; i++) {
    Object.assign(a, { x: a.radius + 0.2, y: a.radius + 0.2, vx: -BALL_SPEED / Math.SQRT2, vy: -BALL_SPEED / Math.SQRT2 });
    const events = battle.advance(SIMULATION_STEP_MS);
    assertBounds(a);
    assert.ok(a.vx > 0 && a.vy > 0);
    assert.equal(a.wallBounces, i + 1);
    assert.equal(a.charge, Math.min(MAX_CHARGE, (i + 1) * CHARGE_PER_BOUNCE));
    assert.equal(events.filter(event => event.kind === 'charge').length, i < Math.ceil(MAX_CHARGE / CHARGE_PER_BOUNCE) ? 1 : 0);
    assert.equal(a.hp, 100);
    assert.equal(b.hp, 100);
  }
});

test('new contact simultaneously damages both balls, spends charge, and heals the surviving renew ball', () => {
  const battle = new BattleSimulator(players(), 2);
  const [a, b] = headOn(battle);
  a.charge = MAX_CHARGE;
  const events = battle.advance(SIMULATION_STEP_MS);
  assert.equal(a.hp, 90);
  assert.equal(b.hp, 100 - 10 - MAX_CHARGE + HEAL_ON_CONTACT);
  assert.equal(a.charge, 0);
  assert.equal(a.damageDealt, 10 + MAX_CHARGE);
  assert.equal(b.damageDealt, 10);
  assert.equal(b.healing, HEAL_ON_CONTACT);
  assert.equal(a.hits, 1);
  assert.equal(b.hits, 1);
  assert.deepEqual(events.map(event => event.kind), ['attack', 'attack', 'heal']);
  assert.ok(a.vx < 0 && b.vx > 0);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.radius + b.radius);
  assert.ok(events.every(event => Number.isFinite(event.x) && Number.isFinite(event.y)));
  assert.equal(battle.advance(200).filter(event => event.kind === 'attack').length, 0, 'separating balls must not receive damage every frame');
});

test('contact separation never counts as another hit while the balls remain in the same contact', () => {
  const battle = new BattleSimulator(players(), 2);
  const [a, b] = headOn(battle);
  battle.advance(SIMULATION_STEP_MS);
  const hp = [a.hp, b.hp];
  // Reproduce a solver correction that leaves a pair touching on the next tick.
  Object.assign(a, { x: ARENA_SIZE / 2 - a.radius - 1, y: ARENA_SIZE / 2, vx: BALL_SPEED, vy: 0 });
  Object.assign(b, { x: ARENA_SIZE / 2 + b.radius - 1, y: ARENA_SIZE / 2, vx: -BALL_SPEED, vy: 0 });
  assert.equal(battle.advance(SIMULATION_STEP_MS).filter(event => event.kind === 'attack').length, 0);
  assert.deepEqual([a.hp, b.hp], hp);
});

test('lethal trades finish as a draw and healing cannot resurrect a defeated renew ball', () => {
  const battle = new BattleSimulator(players(), 2);
  const [a, b] = headOn(battle);
  a.hp = 6; b.hp = 8;
  const events = battle.advance(SIMULATION_STEP_MS);
  assert.deepEqual([a.hp, b.hp], [0, 0]);
  assert.deepEqual(events.map(event => event.kind), ['attack', 'attack', 'end']);
  assert.deepEqual(events.slice(0, 2).map(event => event.amount), [8, 6], 'statistics count actual damage, without overkill');
  assert.equal(battle.snapshot().draw, true);
  assert.equal(battle.snapshot().winnerId, null);
});

test('the surviving renew ball heals in the winning exchange and never exceeds max HP', () => {
  const battle = new BattleSimulator(players(), 2);
  const [a, b] = headOn(battle);
  a.hp = 4; b.hp = 100;
  const events = battle.advance(SIMULATION_STEP_MS);
  assert.equal(b.hp, 90 + HEAL_ON_CONTACT);
  assert.equal(battle.snapshot().winnerId, 'bob');
  assert.deepEqual(events.map(event => event.kind), ['attack', 'attack', 'heal', 'end']);
});

test('overlap recovery at a wall and at coincident centers stays finite and inside the arena', () => {
  for (const coincident of [false, true]) {
    const battle = new BattleSimulator(players(), 2);
    const [a, b] = states(battle);
    Object.assign(a, { x: a.radius, y: 200, vx: 0, vy: 0 });
    Object.assign(b, { x: coincident ? a.radius : a.radius + a.radius + b.radius - 4, y: 200, vx: -BALL_SPEED, vy: 0 });
    battle.advance(SIMULATION_STEP_MS);
    assertBounds(a); assertBounds(b);
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.radius + b.radius - 1e-6);
    for (let i = 0; i < 50 && !battle.snapshot().finished; i++) {
      battle.advance(SIMULATION_STEP_MS);
      assertBounds(a); assertBounds(b);
    }
  }
});

test('large network deltas still detect contacts instead of tunneling through the other ball', () => {
  const battle = new BattleSimulator(players(), 2);
  const [a, b] = states(battle);
  Object.assign(a, { x: 150, y: 260, vx: BALL_SPEED, vy: 0 });
  Object.assign(b, { x: 370, y: 260, vx: -BALL_SPEED, vy: 0 });
  const events = battle.advance(500);
  assert.equal(events.filter(event => event.kind === 'attack').length, 2);
  assert.ok(a.x < b.x, 'head-on balls must bounce before crossing');
  assert.equal(a.hits, 1);
});

test('timeout uses remaining HP ratio, and completed matches stop advancing or emitting events', () => {
  for (const draw of [false, true]) {
    const battle = new BattleSimulator(players(), 2);
    const [a, b] = states(battle);
    Object.assign(a, { x: 100, y: ARENA_SIZE * 0.25, vx: BALL_SPEED, vy: 0, hp: draw ? 50 : 25 });
    Object.assign(b, { x: 100, y: ARENA_SIZE * 0.75, vx: BALL_SPEED, vy: 0, hp: 50 });
    const events = battle.advance(BATTLE_LIMIT_MS + 1000);
    const ended = battle.snapshot();
    assert.equal(ended.elapsedMs, BATTLE_LIMIT_MS);
    assert.equal(ended.draw, draw);
    assert.equal(ended.winnerId, draw ? null : 'bob');
    assert.equal(events.filter(event => event.kind === 'attack').length, 0);
    assert.equal(events.filter(event => event.kind === 'end').length, 1);
    assert.deepEqual(battle.advance(5000), []);
    assert.deepEqual(battle.snapshot(), ended);
  }
});

test('invalid time, seeds, combatants and removed content are rejected', () => {
  const battle = new BattleSimulator(players(), 1);
  for (const delta of [-1, NaN, Infinity, -Infinity]) assert.throws(() => battle.advance(delta), RangeError);
  assert.equal(battle.snapshot().elapsedMs, 0);
  assert.throws(() => new BattleSimulator(players().slice(0, 1), 1));
  assert.throws(() => new BattleSimulator([players()[0], players()[0]], 1));
  assert.throws(() => new BattleSimulator(players(), NaN));
  const invalid = players();
  invalid[0].loadout.items = ['shield'];
  assert.throws(() => new BattleSimulator(invalid, 1));
});

test('all ball pairings and varied seeds remain bounded, trade actual hits and have consistent statistics', () => {
  for (let seed = 0; seed < 80; seed++) {
    const input = players();
    input[0].loadout.petId = PETS[seed % PETS.length].id;
    input[1].loadout.petId = PETS[Math.floor(seed / PETS.length) % PETS.length].id;
    const battle = new BattleSimulator(input, seed);
    const events: BattleEvent[] = [];
    while (!battle.snapshot().finished) {
      events.push(...battle.advance(SIMULATION_STEP_MS));
      const snapshot = battle.snapshot();
      const [a, b] = snapshot.fighters;
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.radius + b.radius - 1e-6, 'ball overlap must be resolved at every physics step');
      for (const fighter of snapshot.fighters) {
        assertBounds(fighter);
        assert.ok(Math.abs(Math.hypot(fighter.vx, fighter.vy) - BALL_SPEED) < 1e-6);
      }
    }
    const final = battle.snapshot();
    assert.ok(final.elapsedMs <= BATTLE_LIMIT_MS);
    assert.equal(events.at(-1)?.kind, 'end');
    assert.ok(events.length < 500);
    for (const fighter of final.fighters) {
      const hits = events.filter(event => event.kind === 'attack' && event.sourceId === fighter.id);
      assert.equal(fighter.hits, hits.length);
      assert.equal(fighter.damageDealt, hits.reduce((sum, event) => sum + event.amount, 0));
      assert.equal(fighter.healing, events.filter(event => event.kind === 'heal' && event.sourceId === fighter.id).reduce((sum, event) => sum + event.amount, 0));
    }
  }
});
