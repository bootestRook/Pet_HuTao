import assert from 'node:assert/strict';
import test from 'node:test';
import { BattleSimulator } from '../server/battle.js';
import { BATTLE_LIMIT_MS, SIMULATION_STEP_MS, createDefaultLoadout } from '../shared/catalog.js';
import { diceOutcome, HUTAO_QUOTES } from '../shared/hutao.js';
import type { BattleEvent, FighterState, PlayerInfo } from '../shared/types.js';

const players = (mirror = false): Pick<PlayerInfo, 'id' | 'name' | 'loadout'>[] => [
  { id: 'a', name: '胡涛一号', loadout: { ...createDefaultLoadout(), petId: 'hutao' } },
  { id: 'b', name: '对手', loadout: { ...createDefaultLoadout(), petId: mirror ? 'hutao' : 'liangchushuo' } },
];
function states(battle: BattleSimulator) {
  const fighters = (battle as unknown as { fighters: { state: FighterState }[] }).fighters.map(({ state }) => state);
  for (const fighter of fighters) fighter.liang = null; // Isolate Hutao from the opponent's courtesy.
  return fighters;
}
function separated(battle: BattleSimulator) {
  const fighters = states(battle);
  for (const fighter of fighters) fighter.liang = null;
  fighters.forEach((fighter, index) => Object.assign(fighter, { x: 100, y: 100 + index * 220, vx: 300, vy: 0 }));
  return fighters;
}
function contact(battle: BattleSimulator) {
  const [a, b] = states(battle);
  Object.assign(a, { x: 177, y: 210, vx: 300, vy: 0 });
  Object.assign(b, { x: 243, y: 210, vx: -300, vy: 0 });
  return battle.advance(SIMULATION_STEP_MS);
}
function prepared(value: number, mirror = false) {
  const battle = new BattleSimulator(players(mirror), 7);
  const fighters = separated(battle);
  battle.advance(10_000);
  fighters[0].diceRoll!.value = value;
  fighters[0].diceRoll!.outcome = diceOutcome(value);
  return { battle, fighters };
}

test('one d6 heals on 1, slaps on 6 and self-damages on 2 through 5', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(diceOutcome), ['heal', 'self-damage', 'self-damage', 'self-damage', 'self-damage', 'slap']);
});

test('roll starts at 10s, settles after 800ms and repeats at 20s without pausing movement', () => {
  const battle = new BattleSimulator(players(), 11);
  const [a] = separated(battle);
  assert.deepEqual(battle.advance(9990), []);
  assert.equal(a.diceRoll, null);
  const start = battle.advance(10);
  assert.equal(start[0].kind, 'roll'); assert.equal(start[0].timeMs, 10_000);
  const x = a.x;
  assert.equal(battle.advance(790).length, 0);
  assert.notEqual(a.x, x); assert.equal(a.diceRoll!.resolved, false);
  const settled = battle.advance(10);
  assert.equal(settled.length, 1); assert.equal(settled[0].timeMs, 10_800);
  assert.equal(a.diceRoll!.resolved, true);
  assert.equal(battle.advance(9190).length, 0);
  assert.equal(battle.advance(10)[0].kind, 'roll');
  assert.equal(a.diceRoll!.startedAtMs, 20_000);
});

test('rolling 1 recovers 12, caps at max HP and counts only effective healing', () => {
  for (const hp of [70, 97, 100]) {
    const { battle, fighters: [a, b] } = prepared(1);
    a.hp = hp;
    const events = battle.advance(800);
    assert.equal(a.hp, Math.min(100, hp + 12)); assert.equal(b.hp, 100);
    assert.equal(a.healing, Math.min(12, 100 - hp));
    assert.equal(events[0].kind, 'heal'); assert.equal(events[0].amount, a.healing);
    assert.equal(a.nostalgiaUsed, false);
  }
});

test('rolling 6 slaps at any distance for 8 without a contact, bounce or nostalgia', () => {
  const { battle, fighters: [a, b] } = prepared(6, true);
  // The opponent has no roll due in this geometry fixture.
  b.diceRoll = null; b.hp = 45; b.vx = 0;
  const before = { vx: b.vx, vy: b.vy, hits: b.hits };
  const events = battle.advance(800);
  assert.equal(b.hp, 37); assert.equal(a.hp, 100);
  assert.equal(a.damageDealt, 8); assert.equal(a.hits, 0); assert.equal(b.hits, before.hits);
  assert.equal(b.vx, before.vx); assert.equal(b.vy, before.vy);
  assert.equal(b.nostalgiaUsed, false);
  assert.equal(events[0].kind, 'slap');
  assert.ok(contact(battle).some(event => event.effect === 'nostalgia'));
  const target = prepared(6); target.fighters[1].hp = 70;
  target.battle.advance(800);
  assert.equal(target.fighters[1].hp, 62);
  assert.equal(target.fighters[1].healing, 0);
});

test('rolling any of 2 through 5 costs 4, can be lethal and does not directly trigger nostalgia', () => {
  for (const value of [2, 3, 4, 5]) {
    const { battle, fighters: [a] } = prepared(value);
    a.hp = 42;
    const events = battle.advance(800);
    assert.equal(a.hp, 38); assert.equal(events[0].amount, 4);
    assert.equal(events[0].kind, 'self-damage'); assert.equal(a.nostalgiaUsed, false);
    const hit = contact(battle);
    assert.equal(a.hp, 53); assert.equal(a.nostalgiaUsed, true);
    assert.equal(hit.find(event => event.effect === 'nostalgia')?.amount, 25);
  }
  const lethal = prepared(2); lethal.fighters[0].hp = 3;
  const killed = lethal.battle.advance(800);
  assert.equal(lethal.fighters[0].hp, 0); assert.equal(lethal.fighters[0].nostalgiaUsed, false);
  assert.equal(killed[0].amount, 3); assert.equal(killed.at(-1)?.kind, 'end');
  assert.deepEqual(lethal.battle.advance(20_000), []);
});

test('nostalgia checks after both collision hits, heals 25 at 40 and runs once per match', () => {
  const battle = new BattleSimulator(players(), 3);
  const [a, b] = states(battle); a.hp = 50;
  const events = contact(battle);
  assert.equal(a.hp, 65); assert.equal(a.healing, 25); assert.equal(a.nostalgiaUsed, true);
  assert.deepEqual(events.slice(0, 2).map(event => event.kind), ['attack', 'attack']);
  assert.equal(events.find(event => event.effect === 'nostalgia')?.amount, 25);
  battle.advance(100); a.hp = 50;
  assert.equal(contact(battle).filter(event => event.effect === 'nostalgia').length, 0);
  assert.equal(a.hp, 40);
  const fresh = new BattleSimulator(players(), 3);
  assert.equal(states(fresh)[0].nostalgiaUsed, false);
  a.hp = 10; b.hp = 10;
  battle.advance(100);
  contact(battle);
  assert.equal(a.hp, 0);
});

test('a lethal collision never revives Hu Tao or resolves an outstanding roll later', () => {
  const { battle, fighters: [a, b] } = prepared(1);
  a.hp = 10; b.hp = 10;
  const events = contact(battle);
  assert.equal(a.hp, 0); assert.equal(a.nostalgiaUsed, false);
  assert.equal(battle.snapshot().draw, true);
  assert.equal(events.filter(event => event.kind === 'heal').length, 0);
  assert.deepEqual(battle.advance(10_000), []);
  assert.equal(a.diceRoll!.resolved, false);
});

test('mirror slaps settle together, count actual damage and allow a lethal draw', () => {
  const { battle, fighters: [a, b] } = prepared(6, true);
  b.diceRoll!.value = 6; b.diceRoll!.outcome = 'slap';
  a.hp = 5; b.hp = 7;
  const events = battle.advance(800);
  assert.deepEqual([a.hp, b.hp], [0, 0]);
  assert.deepEqual(events.map(event => event.kind), ['slap', 'slap', 'end']);
  assert.deepEqual([a.damageDealt, b.damageDealt], [7, 5]);
  assert.equal(battle.snapshot().draw, true);
});

test('roll snapshots are deeply detached, seeded faces are d6 and all exact quotes can occur', () => {
  const quotes = new Set<string>(); const outcomes = new Set<string>();
  for (let seed = 0; seed < 160; seed++) {
    const battle = new BattleSimulator(players(), seed); separated(battle); battle.advance(10_000);
    const roll = battle.snapshot().fighters[0].diceRoll!;
    assert.ok(Number.isInteger(roll.value) && roll.value >= 1 && roll.value <= 6);
    quotes.add(roll.quote); outcomes.add(roll.outcome);
    roll.value = 99; roll.resolved = true;
    assert.notEqual(states(battle)[0].diceRoll!.value, 99);
    assert.equal(states(battle)[0].diceRoll!.resolved, false);
  }
  assert.deepEqual([...quotes].sort(), [...HUTAO_QUOTES].sort());
  assert.equal(outcomes.size, 3);
});

test('dice, quotes and results replay identically across seats and network chunk sizes', () => {
  for (const mirror of [false, true]) {
    const whole = new BattleSimulator(players(mirror), 18);
    const chunks = new BattleSimulator(players(mirror).reverse(), 18);
    const expected = whole.advance(BATTLE_LIMIT_MS);
    const actual: BattleEvent[] = [];
    while (!chunks.snapshot().finished) actual.push(...chunks.advance(137));
    assert.deepEqual(actual, expected); assert.deepEqual(chunks.snapshot(), whole.snapshot());
  }
});

test('the five-minute timeout does not start an unresolvable final dice roll', () => {
  const battle = new BattleSimulator(players(), 5);
  const [a] = separated(battle); a.hp = 1000; a.maxHp = 1000;
  const events = battle.advance(BATTLE_LIMIT_MS);
  assert.equal(battle.snapshot().elapsedMs, BATTLE_LIMIT_MS);
  assert.equal(battle.snapshot().finished, true);
  assert.equal(events.filter(event => event.kind === 'roll').length, 29);
  assert.equal(a.diceRoll!.startedAtMs, 290_000);
  assert.equal(a.diceRoll!.resolved, true);
  assert.equal(events.at(-1)?.kind, 'end');
});
