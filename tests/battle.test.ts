import assert from 'node:assert/strict';
import test from 'node:test';
import { BattleSimulator } from '../server/battle.js';
import { ARENA_SIZE, BATTLE_LIMIT_MS, PETS, SIMULATION_STEP_MS, createDefaultLoadout } from '../shared/catalog.js';
import type { BattleEvent, FighterState, PlayerInfo } from '../shared/types.js';

type Combatant = Pick<PlayerInfo, 'id' | 'name' | 'loadout'>;
const BALL_SPEED = PETS.find(pet => pet.id === 'liangchushuo')!.speed;
const players = (): Combatant[] => [
  { id: 'alice', name: '碰撞玩家甲', loadout: { ...createDefaultLoadout(), petId: 'liangchushuo' } },
  { id: 'bob', name: '碰撞玩家乙', loadout: { ...createDefaultLoadout(), petId: 'liangchushuo' } },
];
// Only the tests reposition balls to reproduce exact contact geometries.
// Production has no position setters or client-supplied combat state.
function states(battle: BattleSimulator): FighterState[] {
  return (battle as unknown as { fighters: { state: FighterState }[] }).fighters.map(fighter => fighter.state);
}
function plainBattle(seed: number) {
  const battle = new BattleSimulator(players(), seed);
  for (const state of states(battle)) state.liang = null; // Physics fixtures isolate collision from character effects.
  return battle;
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
}

test('balls move immediately without timer damage, and snapshots do not expose mutable state', () => {
  const inputs = players();
  const battle = new BattleSimulator(inputs, 42);
  const initial = battle.snapshot();
  assert.equal(initial.elapsedMs, 0);
  assert.equal(initial.finished, false);
  assert.deepEqual(initial.fighters.map(f => f.hp), [100, 100]);
  assert.deepEqual(battle.advance(0), []);
  inputs[0].loadout.petId = 'hutao';
  initial.fighters[0].hp = 0;
  initial.fighters[0].x = -1000;
  assert.equal(battle.snapshot().fighters[0].petId, 'liangchushuo');
  assert.equal(battle.snapshot().fighters[0].hp, 100);
  battle.advance(100);
  const moved = battle.snapshot();
  assert.ok(moved.fighters.every((fighter, index) => fighter.x !== initial.fighters[index].x));
  assert.deepEqual(moved.fighters.map(f => f.hp), [100, 100]);
  assert.equal(moved.elapsedMs, 100);
});

test('character attributes set starting HP, traded damage and speed after contacts and wall bounces', () => {
  const input = players();
  input[0].loadout.petId = 'hutao';
  input[1].loadout.petId = 'chengzhiquan';
  const battle = new BattleSimulator(input, 42);
  const initial = battle.snapshot().fighters;
  assert.deepEqual(initial.map(fighter => [fighter.hp, fighter.maxHp]), [[100, 100], [120, 120]]);
  for (const [index, speed] of [330, 240].entries()) {
    assert.ok(Math.abs(Math.hypot(initial[index].vx, initial[index].vy) - speed) < 1e-6);
  }
  const [a, b] = states(battle);
  Object.assign(a, { x: 177, y: 210, vx: 330, vy: 0 });
  Object.assign(b, { x: 243, y: 210, vx: -240, vy: 0 });
  const events = battle.advance(SIMULATION_STEP_MS);
  assert.deepEqual(events.map(event => [event.kind, event.amount]), [['attack', 14], ['attack', 7]]);
  assert.deepEqual([a.hp, b.hp], [93, 106]);
  assert.ok(Math.abs(a.vx + 330) < 1e-6);
  assert.ok(Math.abs(b.vx - 240) < 1e-6);
  Object.assign(a, { x: a.radius + 0.2, y: 100 });
  Object.assign(b, { x: ARENA_SIZE - b.radius - 0.2, y: 320 });
  assert.deepEqual(battle.advance(SIMULATION_STEP_MS), []);
  assert.ok(Math.abs(a.vx - 330) < 1e-6);
  assert.ok(Math.abs(b.vx + 240) < 1e-6);
  assert.deepEqual([a.wallBounces, b.wallBounces], [1, 1]);
  assert.deepEqual([a.hp, b.hp], [93, 106]);
});

test('the five-minute limit keeps separated living balls moving beyond the old 60-second cutoff', () => {
  assert.equal(BATTLE_LIMIT_MS, 5 * 60_000);
  const battle = plainBattle(5);
  (battle as unknown as { world: { state: { nextAtMs: number } } }).world.state.nextAtMs = Infinity;
  const [a, b] = states(battle);
  Object.assign(a, { x: 100, y: 100, vx: BALL_SPEED, vy: 0 });
  Object.assign(b, { x: 100, y: 320, vx: BALL_SPEED, vy: 0 });
  assert.equal(battle.advance(60_000).some(e => e.kind === 'end'), false);
  const before = battle.snapshot();
  battle.advance(1000);
  assert.equal(battle.snapshot().elapsedMs, 61_000); assert.equal(battle.snapshot().finished, false);
  assert.notEqual(battle.snapshot().fighters[0].x, before.fighters[0].x);
  assert.equal(battle.advance(BATTLE_LIMIT_MS).filter(e => e.kind === 'end').length, 1);
  assert.equal(battle.snapshot().elapsedMs, BATTLE_LIMIT_MS);
});

test('fixed steps retain sub-frame time and seeded results are independent of network chunk size', () => {
  const whole = plainBattle(123456);
  const chunks = plainBattle(123456);
  const expected = whole.advance(BATTLE_LIMIT_MS);
  const actual: BattleEvent[] = [];
  while (!chunks.snapshot().finished) actual.push(...chunks.advance(37));
  assert.deepEqual(actual, expected);
  assert.deepEqual(chunks.snapshot(), whole.snapshot());
  assert.deepEqual(expected.map(event => event.seq), expected.map((_, i) => i + 1));
  const fractional = plainBattle(42);
  for (let i = 0; i < 100; i++) fractional.advance(0.1);
  const oneStep = plainBattle(42);
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

test('walls reflect velocity and count a corner once without hurting either ball', () => {
  const battle = plainBattle(1);
  const [a, b] = states(battle);
  Object.assign(b, { x: ARENA_SIZE * 0.75, y: ARENA_SIZE * 0.75, vx: 0, vy: 0 });
  for (let i = 0; i < 5; i++) {
    Object.assign(a, { x: a.radius + 0.2, y: a.radius + 0.2, vx: -BALL_SPEED / Math.SQRT2, vy: -BALL_SPEED / Math.SQRT2 });
    const events = battle.advance(SIMULATION_STEP_MS);
    assertBounds(a);
    assert.ok(a.vx > 0 && a.vy > 0);
    assert.equal(a.wallBounces, i + 1);
    assert.deepEqual(events, []);
    assert.equal(a.hp, 100);
    assert.equal(b.hp, 100);
  }
});

test('new contact simultaneously damages both balls exactly once', () => {
  const battle = plainBattle(2);
  const [a, b] = headOn(battle);
  const events = battle.advance(SIMULATION_STEP_MS);
  assert.equal(a.hp, 90);
  assert.equal(b.hp, 90);
  assert.equal(a.damageDealt, 10);
  assert.equal(b.damageDealt, 10);
  assert.equal(b.healing, 0);
  assert.equal(a.hits, 1);
  assert.equal(b.hits, 1);
  assert.deepEqual(events.map(event => event.kind), ['attack', 'attack']);
  assert.ok(a.vx < 0 && b.vx > 0);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.radius + b.radius);
  assert.ok(events.every(event => Number.isFinite(event.x) && Number.isFinite(event.y)));
  assert.equal(battle.advance(200).filter(event => event.kind === 'attack').length, 0, 'separating balls must not receive damage every frame');
});

test('contact separation never counts as another hit while the balls remain in the same contact', () => {
  const battle = plainBattle(2);
  const [a, b] = headOn(battle);
  battle.advance(SIMULATION_STEP_MS);
  const hp = [a.hp, b.hp];
  // Reproduce a solver correction that leaves a pair touching on the next tick.
  Object.assign(a, { x: ARENA_SIZE / 2 - a.radius - 1, y: ARENA_SIZE / 2, vx: BALL_SPEED, vy: 0 });
  Object.assign(b, { x: ARENA_SIZE / 2 + b.radius - 1, y: ARENA_SIZE / 2, vx: -BALL_SPEED, vy: 0 });
  assert.equal(battle.advance(SIMULATION_STEP_MS).filter(event => event.kind === 'attack').length, 0);
  assert.deepEqual([a.hp, b.hp], hp);
});

test('lethal trades finish as a draw and count only actual damage', () => {
  const battle = plainBattle(2);
  const [a, b] = headOn(battle);
  a.hp = 6; b.hp = 8;
  const events = battle.advance(SIMULATION_STEP_MS);
  assert.deepEqual([a.hp, b.hp], [0, 0]);
  assert.deepEqual(events.map(event => event.kind), ['attack', 'attack', 'end']);
  assert.deepEqual(events.slice(0, 2).map(event => event.amount), [8, 6], 'statistics count actual damage, without overkill');
  assert.equal(battle.snapshot().draw, true);
  assert.equal(battle.snapshot().winnerId, null);
});

test('the surviving ball wins after simultaneous collision damage', () => {
  const battle = plainBattle(2);
  const [a, b] = headOn(battle);
  a.hp = 4; b.hp = 100;
  const events = battle.advance(SIMULATION_STEP_MS);
  assert.equal(b.hp, 90);
  assert.equal(battle.snapshot().winnerId, 'bob');
  assert.deepEqual(events.map(event => event.kind), ['attack', 'attack', 'end']);
});

test('overlap recovery at a wall and at coincident centers stays finite and inside the arena', () => {
  for (const coincident of [false, true]) {
    const battle = plainBattle(2);
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
  const battle = plainBattle(2);
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
    const battle = plainBattle(2);
    // Isolate timeout's ratio rule from the separately covered battlefield effects.
    (battle as unknown as { world: { state: { nextAtMs: number } } }).world.state.nextAtMs = Infinity;
    const [a, b] = states(battle);
    Object.assign(a, { x: 100, y: ARENA_SIZE * 0.25, vx: BALL_SPEED, vy: 0, hp: draw ? 50 : 25 });
    Object.assign(b, { x: 100, y: ARENA_SIZE * 0.75, vx: BALL_SPEED, vy: 0, hp: 50 });
    const events = battle.advance(BATTLE_LIMIT_MS + 1000);
    const ended = battle.snapshot();
    assert.equal(ended.elapsedMs, 5 * 60_000);
    assert.deepEqual(ended.fighters.map(fighter => fighter.hp), [draw ? 50 : 25, 50]);
    assert.equal(ended.draw, draw);
    assert.equal(ended.winnerId, draw ? null : 'bob');
    assert.equal(events.filter(event => event.kind === 'attack').length, 0);
    assert.equal(events.filter(event => event.kind === 'end').length, 1);
    assert.deepEqual(battle.advance(5000), []);
    assert.deepEqual(battle.snapshot(), ended);
  }
});

test('invalid time, seeds, combatants and removed content are rejected', () => {
  const battle = plainBattle(1);
  for (const delta of [-1, NaN, Infinity, -Infinity]) assert.throws(() => battle.advance(delta), RangeError);
  assert.equal(battle.snapshot().elapsedMs, 0);
  assert.throws(() => new BattleSimulator(players().slice(0, 1), 1));
  assert.throws(() => new BattleSimulator([players()[0], players()[0]], 1));
  assert.throws(() => plainBattle(NaN));
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
        assert.ok(Math.abs(Math.hypot(fighter.vx, fighter.vy) - PETS.find(pet => pet.id === fighter.petId)!.speed) < 1e-6);
      }
    }
    const final = battle.snapshot();
    assert.ok(final.elapsedMs <= BATTLE_LIMIT_MS);
    assert.equal(events.at(-1)?.kind, 'end');
    // Five-minute mirror Cheng matches also emit meals, three drain/heal pairs,
    // and bind/release events every cycle; they legitimately exceed the old 500.
    assert.ok(events.length < 1000);
    for (const fighter of final.fighters) {
      const hits = events.filter(event => event.kind === 'attack' && event.sourceId === fighter.id);
      assert.equal(fighter.hits, hits.length);
      assert.equal(fighter.damageDealt, events.filter(event => ['attack', 'slap', 'drain'].includes(event.kind) && event.sourceId === fighter.id).reduce((sum, event) => sum + event.amount, 0));
      assert.equal(fighter.healing, events.filter(event => event.kind === 'heal' && event.sourceId === fighter.id).reduce((sum, event) => sum + event.amount, 0));
      const lost = events.filter(event => ['attack', 'slap', 'self-damage', 'drain', 'arena-damage'].includes(event.kind) && event.targetId === fighter.id).reduce((sum, event) => sum + event.amount, 0);
      const balanced = events.filter(event => event.kind === 'balance' && event.targetId === fighter.id).reduce((sum, event) => sum + event.amount, 0);
      assert.equal(fighter.hp, fighter.maxHp - lost + fighter.healing + balanced, 'all HP changes must be explained by authoritative events');
    }
  }
});
