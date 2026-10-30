import assert from 'node:assert/strict';
import test from 'node:test';
import { BattleSimulator } from '../server/battle.js';
import { ARENA_SIZE, BATTLE_LIMIT_MS, createDefaultLoadout } from '../shared/catalog.js';
import type { BattleEvent, FighterState, PetId } from '../shared/types.js';

function setup(opponent: PetId = 'liangchushuo') {
  const players = ['a', 'b'].map((id, i) => ({ id, name: id, loadout: { ...createDefaultLoadout(), petId: (i === 0 ? 'chengzhiquan' : opponent) as PetId } }));
  const battle = new BattleSimulator(players, 7);
  const fighters = (battle as unknown as { fighters: { state: FighterState }[] }).fighters.map(f => f.state);
  fighters.forEach(state => { state.liang = null; });
  fighters.forEach((state, i) => Object.assign(state, { x: 100, y: 100 + i * 220, vx: 0, vy: 0 }));
  return { battle, a: fighters[0], b: fighters[1] };
}
function disableFood(state: FighterState) { state.cheng!.nextMealAtMs = Infinity; }
function contact(battle: BattleSimulator, a: FighterState, b: FighterState) {
  Object.assign(a, { x: 177, y: 210, vx: 300, vy: 0 });
  Object.assign(b, { x: 243, y: 210, vx: -300, vy: 0 });
  return battle.advance(10);
}
function separate(a: FighterState, b: FighterState) {
  Object.assign(a, { x: 100, y: 100, vx: 0, vy: 0 });
  Object.assign(b, { x: 100, y: 320, vx: 0, vy: 0 });
}

test('food strictly requires HP <50, settles at 600ms and cools down from its start', () => {
  const { battle, a } = setup();
  a.hp = 50;
  assert.equal(battle.advance(10).length, 0);
  a.hp = 49;
  assert.equal(battle.advance(10)[0].kind, 'meal');
  assert.equal(a.cheng!.mealStartedAtMs, 20);
  battle.advance(590); assert.equal(a.hp, 49);
  const healed = battle.advance(10);
  assert.equal(a.hp, 55); assert.equal(a.healing, 6); assert.equal(a.cheng!.meals, 1);
  assert.equal(healed[0].effect, 'meal');
  a.hp = 40;
  battle.advance(5390); assert.equal(a.cheng!.mealStartedAtMs, null);
  assert.equal(battle.advance(10)[0].kind, 'meal');
  assert.equal(a.cheng!.mealStartedAtMs, 6020);
});

test('food has no eight-meal limit, and a started meal heals even if HP crosses 50', () => {
  const { battle, a } = setup();
  for (let i = 0; i < 9; i++) {
    a.hp = 40;
    battle.advance(i ? 5400 : 10);
    a.hp = a.maxHp - 2;
    battle.advance(600);
    assert.equal(a.hp, a.maxHp);
  }
  assert.equal(a.cheng!.meals, 9); assert.equal(a.healing, 18);
});

test('lethal collision is wholly cancelled at original HP; invulnerability expires exactly at 5s and is once per round', () => {
  const { battle, a, b } = setup(); a.hp = 7; disableFood(a); a.cheng!.nextGrappleAtMs = Infinity;
  const events = contact(battle, a, b);
  assert.equal(a.hp, 7); assert.equal(a.cheng!.survivalUsed, true);
  assert.equal(a.cheng!.invulnerableUntilMs, 5010); assert.equal(events.filter(e => e.kind === 'survive').length, 1);
  assert.equal(b.damageDealt, 0);
  separate(a, b); battle.advance(10);
  assert.equal(contact(battle, a, b).filter(e => e.kind === 'immune').length, 1);
  assert.equal(a.hp, 7);
  separate(a, b); battle.advance(4970);
  const expired = contact(battle, a, b);
  assert.equal(a.hp, 0); assert.equal(battle.snapshot().finished, true);
  assert.equal(expired.filter(e => e.kind === 'survive').length, 0);
});

test('remote Hutao slap uses the same lethal protection and does not award blocked damage', () => {
  const { battle, a, b } = setup('hutao');
  battle.advance(10_000);
  a.hp = 7; disableFood(a); a.cheng!.nextGrappleAtMs = Infinity;
  Object.assign(b.diceRoll!, { value: 6, outcome: 'slap' });
  const events = battle.advance(800);
  assert.equal(a.hp, 7); assert.equal(b.damageDealt, 0);
  assert.equal(events.filter(e => e.kind === 'survive').length, 1);
  assert.equal(events.find(e => e.kind === 'slap')!.amount, 0);
});

test('low HP unlocks immediate 250ms flight; both balls stay fixed for all three 2HP drains', () => {
  const { battle, a, b } = setup(); a.hp = 30; disableFood(a);
  a.vx = 300; b.vx = -300;
  const start = battle.advance(10);
  assert.equal(start.filter(e => e.kind === 'dash').length, 1);
  assert.equal(a.cheng!.nextGrappleAtMs, 10010);
  battle.advance(240); assert.ok(a.cheng!.dash); assert.equal(a.boundUntilMs, 0);
  const arrival = battle.advance(10); assert.equal(arrival[0].kind, 'bind');
  assert.equal(a.boundUntilMs, 3260); assert.equal(b.boundUntilMs, 3260);
  const fixed = [a.x, a.y, b.x, b.y];
  const drains: BattleEvent[] = [];
  for (let i = 1; i <= 3; i++) {
    const events = battle.advance(1000); drains.push(...events);
    assert.deepEqual([a.x, a.y, b.x, b.y], fixed, 'both sides remain motionless through the final tick');
    assert.equal(a.hp, 30 + i * 2); assert.equal(b.hp, 100 - i * 2);
  }
  assert.deepEqual(drains.filter(e => e.kind === 'drain').map(e => e.timeMs), [1260, 2260, 3260]);
  assert.equal(a.damageDealt, 6); assert.equal(a.healing, 6); assert.equal(a.hits, 0); assert.equal(b.hits, 0);
  assert.equal(a.boundUntilMs, 0); assert.equal(b.boundUntilMs, 0);
  assert.equal(a.cheng!.grapple, null);
  battle.advance(10); assert.notDeepEqual([a.x, a.y, b.x, b.y], fixed);
});

test('healing above 30 does not relock the skill; second flight begins 10s after the first', () => {
  const { battle, a, b } = setup(); a.hp = 30; disableFood(a);
  battle.advance(3260); separate(a, b); a.hp = 80;
  const events = battle.advance(6740);
  assert.equal(events.filter(e => e.kind === 'dash').length, 0);
  const next = battle.advance(10);
  assert.equal(next.find(e => e.kind === 'dash')!.timeMs, 10010);
  assert.equal(a.cheng!.grappleUnlocked, true);
});

test('meals continue during bilateral binding and during invulnerability', () => {
  const { battle, a, b } = setup(); a.hp = 20;
  battle.advance(260); const fixed = [a.x, a.y, b.x, b.y];
  a.cheng!.invulnerableUntilMs = 5000;
  battle.advance(350);
  assert.equal(a.hp, 26); assert.equal(a.cheng!.meals, 1);
  assert.deepEqual([a.x, a.y, b.x, b.y], fixed);
});

test('invulnerable victim stays bound but supplies zero drain healing', () => {
  const { battle, a, b } = setup('chengzhiquan'); a.hp = 30; disableFood(a);
  b.cheng!.invulnerableUntilMs = 5000; b.cheng!.survivalUsed = true;
  const events = battle.advance(3260);
  assert.equal(events.filter(e => e.kind === 'bind').length, 1);
  assert.equal(events.filter(e => e.kind === 'immune').length, 3);
  assert.equal(a.hp, 30); assert.equal(a.healing, 0); assert.equal(a.damageDealt, 0); assert.equal(b.hp, b.maxHp);
});

test('drain lethal protection preserves victim HP and grants no healing', () => {
  const { battle, a, b } = setup('chengzhiquan'); a.hp = 30; b.hp = 1;
  disableFood(a); disableFood(b); b.cheng!.nextGrappleAtMs = Infinity;
  const events = battle.advance(1260);
  assert.equal(b.hp, 1); assert.equal(b.cheng!.survivalUsed, true);
  assert.equal(events.filter(e => e.kind === 'survive').length, 1);
  assert.equal(a.healing, 0);
});

test('final partial drain heals actual loss, ends binding, and never keeps ticking after battle end', () => {
  const { battle, a, b } = setup(); a.hp = 30; b.hp = 1; disableFood(a);
  const events = battle.advance(5000);
  assert.equal(a.hp, 31); assert.equal(a.healing, 1); assert.equal(a.damageDealt, 1);
  assert.equal(events.find(e => e.kind === 'drain')!.amount, 1);
  assert.equal(b.hp, 0); assert.equal(battle.snapshot().winnerId, 'a');
  assert.equal(a.boundUntilMs, 0); assert.equal(b.boundUntilMs, 0); assert.equal(a.cheng!.grapple, null);
  const snapshot = battle.snapshot(); assert.deepEqual(battle.advance(30_000), []); assert.deepEqual(battle.snapshot(), snapshot);
});

test('mirror flights meet without overlapping; simultaneous lethal drains draw without resurrection', () => {
  const { battle, a, b } = setup('chengzhiquan');
  for (const fighter of [a, b]) { fighter.hp = 2; disableFood(fighter); fighter.cheng!.survivalUsed = true; }
  const start = battle.advance(10); assert.equal(start.filter(e => e.kind === 'dash').length, 2);
  const events = battle.advance(1250);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 64);
  assert.equal(events.filter(e => e.kind === 'bind').length, 2);
  assert.equal(a.hp, 0); assert.equal(b.hp, 0); assert.equal(a.healing, 0); assert.equal(b.healing, 0);
  assert.equal(battle.snapshot().draw, true);
});

test('dash landing is legal at all corners and does not add collision hits', () => {
  for (const [x, y] of [[32, 32], [388, 32], [32, 388], [388, 388]]) {
    const { battle, a, b } = setup(); a.hp = 30; disableFood(a);
    Object.assign(a, { x: 210, y: 210 }); Object.assign(b, { x, y });
    const events = battle.advance(260);
    for (const f of [a, b]) {
      assert.ok(f.x >= 32 && f.x <= ARENA_SIZE - 32); assert.ok(f.y >= 32 && f.y <= ARENA_SIZE - 32);
    }
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 64);
    assert.equal(events.filter(e => e.kind === 'attack').length, 0);
  }
});

test('nested skill snapshots are detached and chunking / seating preserve results', () => {
  const { battle, a } = setup(); a.hp = 30; battle.advance(10);
  const snapshot = battle.snapshot(); snapshot.fighters[0].cheng!.dash!.toX = -999;
  assert.notEqual(a.cheng!.dash!.toX, -999);
  battle.advance(250); const bound = battle.snapshot(); bound.fighters[0].cheng!.grapple!.ticks = 88;
  assert.equal(a.cheng!.grapple!.ticks, 0);
  for (const mirror of [false, true]) {
    const players = ['a', 'b'].map((id, i) => ({ id, name: id, loadout: { ...createDefaultLoadout(), petId: (i === 0 || mirror ? 'chengzhiquan' : 'hutao') as PetId } }));
    for (let seed = 0; seed < 8; seed++) {
      const whole = new BattleSimulator(players, seed), chunks = new BattleSimulator([...players].reverse(), seed);
      const expected = whole.advance(BATTLE_LIMIT_MS + 20_000); const actual: BattleEvent[] = [];
      while (!chunks.snapshot().finished) actual.push(...chunks.advance(37));
      assert.deepEqual(actual, expected); assert.deepEqual(chunks.snapshot(), whole.snapshot());
    }
  }
});

test('death before meal completion cancels healing and pending flight', () => {
  const { battle, a, b } = setup(); a.hp = 7; a.cheng!.survivalUsed = true;
  a.cheng!.nextGrappleAtMs = Infinity;
  battle.advance(10); assert.notEqual(a.cheng!.mealStartedAtMs, null);
  contact(battle, a, b);
  assert.equal(a.hp, 0); assert.equal(a.healing, 0);
  assert.equal(a.cheng!.mealStartedAtMs, null); assert.equal(a.cheng!.dash, null);
});

test('a bound opponent still resolves timed abilities while both positions stay fixed', () => {
  const { battle, a, b } = setup('hutao');
  battle.advance(10_000); a.hp = 30; disableFood(a);
  Object.assign(b.diceRoll!, { value: 6, outcome: 'slap' });
  battle.advance(260); const fixed = [a.x, a.y, b.x, b.y];
  const events = battle.advance(540);
  assert.deepEqual([a.x, a.y, b.x, b.y], fixed);
  assert.equal(events.find(e => e.kind === 'slap')!.amount, 8);
  assert.equal(a.hp, 22); assert.equal(b.diceRoll!.resolved, true);
});

test('unlock during binding waits for release instead of allowing the victim to dash away', () => {
  const { battle, a, b } = setup('chengzhiquan'); a.hp = 30; b.hp = 31;
  disableFood(a); disableFood(b);
  battle.advance(1260);
  assert.equal(b.cheng!.grappleUnlocked, true); assert.equal(b.cheng!.dash, null);
  const fixed = [a.x, a.y, b.x, b.y];
  const events = battle.advance(1990);
  assert.deepEqual([a.x, a.y, b.x, b.y], fixed);
  assert.equal(events.filter(e => e.kind === 'dash').length, 0);
  const released = battle.advance(10);
  assert.equal(released.find(e => e.kind === 'dash')!.sourceId, 'b');
  assert.equal(b.cheng!.dash!.startedAtMs, 3260);
});
