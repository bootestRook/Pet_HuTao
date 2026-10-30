import test from 'node:test';
import assert from 'node:assert/strict';
import { BattleSimulator } from '../server/battle.js';
import type { ItemFighter } from '../server/battle-items.js';
import { createDefaultLoadout, ITEMS } from '../shared/catalog.js';
import type { BattleEvent, DamageKind, PetId } from '../shared/types.js';

interface Internals {
  fighters: ItemFighter[];
  world: { state: { nextAtMs: number } };
  damage(events: BattleEvent[], source: ItemFighter, target: ItemFighter, value: number, kind: DamageKind, label: string): number;
}
function setup(items: string[], otherItems: string[] = [], seed = 7, pet: PetId = 'liangchushuo') {
  const players = ['a', 'b'].map((id, i) => ({ id, name: id, loadout: { ...createDefaultLoadout(), petId: i ? 'liangchushuo' as const : pet, items: i ? otherItems : items } }));
  const battle = new BattleSimulator(players, seed), initial = battle.snapshot();
  const inner = battle as unknown as Internals;
  inner.world.state.nextAtMs = Infinity; // Isolate item clocks from separately tested battlefield rules.
  const [a, b] = inner.fighters.map(f => f.state);
  a.liang = b.liang = null; // Isolate item/world rules from character effects.
  Object.assign(a, { x: 100, y: 100, vx: 0, vy: 0 }); Object.assign(b, { x: 100, y: 320, vx: 0, vy: 0 });
  const deal = (value: number, source = 1, target = 0, kind: DamageKind = 'attack') => {
    const events: BattleEvent[] = []; inner.damage(events, inner.fighters[source], inner.fighters[target], value, kind, '边界命中'); return events;
  };
  return { battle, initial, inner, a, b, deal };
}
function awakened() {
  for (let seed = 0; seed < 5000; seed++) {
    const result = setup(['plain-club'], [], seed, 'liangchushuo');
    if (result.a.items.staffAwakened) return result;
  }
  throw new Error('No awakened seed in deterministic sample');
}

test('ticket first rolls at 7s, 99% fireworks change no combat values, and the strict 1% branch heals to current maximum', () => {
  const { battle, inner, a } = setup(['lucky-ticket']); a.hp = 40;
  inner.fighters[0].itemRandom = () => 0.01;
  battle.advance(6990); assert.equal(a.items.ticketRolls, 0);
  const missed = battle.advance(10); assert.equal(a.items.ticketRolls, 1); assert.equal(a.hp, 40); assert.equal(a.healing, 0);
  assert.ok(missed.some(e => e.effect === 'lucky-ticket' && e.text.includes('烟花'))); assert.equal(missed.some(e => e.kind === 'heal'), false);
  inner.fighters[0].itemRandom = () => 0.009999;
  a.maxHp = 150; const won = battle.advance(7000);
  assert.equal(a.hp, 150); assert.equal(a.healing, 110); assert.equal(a.items.ticketWins, 1);
  assert.equal(won.find(e => e.kind === 'heal')?.amount, 110);
});

test('club adds three collision damage, rolls transformation only at match start and announces awakened state', () => {
  const plain = setup(['plain-club']); plain.a.items.staffAwakened = false;
  Object.assign(plain.a, { x: 177, y: 210, vx: 300 }); Object.assign(plain.b, { x: 243, y: 210, vx: -300 });
  plain.battle.advance(10); assert.equal(plain.b.hp, 87); assert.equal(plain.a.hits, 1);
  const rare = awakened();
  assert.ok(rare.battle.advance(10).some(e => e.effect === 'staff' && e.text.includes('升华')));
  assert.equal(rare.battle.snapshot().fighters[0].items.staffAwakened, true);
  const snapshot = rare.battle.snapshot(); snapshot.fighters[0].items.staffAwakened = false;
  assert.equal(rare.a.items.staffAwakened, true);
});

test('golden staff generates 1–5 independent collision damage segments without duplicating contact counters', () => {
  for (let segments = 1; segments <= 5; segments++) {
    const { battle, inner, a, b } = awakened();
    inner.fighters[0].itemRandom = () => (segments - 1) / 5;
    a.hp = 50; b.hp = b.maxHp = 1000;
    Object.assign(a, { x: 177, y: 210, vx: 300 }); Object.assign(b, { x: 243, y: 210, vx: -300 });
    const events = battle.advance(10), extra = events.filter(e => e.kind === 'combo');
    assert.equal(extra.length, segments); assert.ok(extra.every(e => e.amount === 13));
    assert.equal(b.hp, 1000 - (segments + 1) * 13); assert.equal(a.hits, 1);
    assert.equal(a.hp, 40); assert.equal(a.healing, 0);
  }
});

test('staff ends additional segments once its target dies, counting effective damage only', () => {
  const { battle, inner, a, b } = awakened(); inner.fighters[0].itemRandom = () => 0.999;
  b.hp = 20; Object.assign(a, { x: 177, y: 210, vx: 300 }); Object.assign(b, { x: 243, y: 210, vx: -300 });
  const events = battle.advance(10);
  assert.equal(events.filter(e => e.kind === 'combo').length, 1); assert.equal(a.damageDealt, 20); assert.equal(b.hp, 0);
});

test('thorns reduce initial speed 25%, react to actual, self and lethal damage, without reflecting reflection or environmental damage', () => {
  const { battle, initial, a, b, deal } = setup(['thorn-armor'], ['thorn-armor']);
  assert.ok(Math.abs(Math.hypot(initial.fighters[0].vx, initial.fighters[0].vy) - 225) < 1e-6);
  const hit = deal(10); assert.deepEqual([a.hp, b.hp], [90, 98]); assert.equal(hit.filter(e => e.kind === 'reflection').length, 1);
  deal(4, 0, 0, 'self-damage'); assert.equal(a.hp, 84);
  deal(3, 0, 0, 'arena-damage'); assert.equal(a.hp, 81);
  a.world.invulnerableUntilMs = 100; deal(10); assert.equal(b.hp, 98);
  a.world.invulnerableUntilMs = 0; a.hp = 1; deal(10); assert.deepEqual([a.hp, b.hp], [0, 96]);
  battle.advance(10); assert.equal(battle.snapshot().finished, true);
});

test('reflection-origin installments retain recursion suppression while normal installments each trigger thorns', () => {
  const { battle, a, b, deal } = setup(['thorn-armor', 'pain-installment'], ['thorn-armor', 'pain-installment']);
  const events = deal(10); events.push(...battle.advance(5000));
  assert.deepEqual([a.hp, b.hp], [90, 90]); assert.equal(events.filter(e => e.kind === 'reflection').length, 5);
  assert.equal(a.items.debts.length + b.items.debts.length, 0); assert.ok(events.length < 40);
});

test('ascension triggers exactly at 180 combat seconds once, increases cap, fully heals, and multiplies existing speed modifiers', () => {
  const { battle, a } = setup(['ascension-charm', 'thorn-armor']); a.hp = 20;
  battle.advance(179_990); assert.equal(a.maxHp, 100); assert.equal(a.items.ascended, false);
  a.vx = 225; const events = battle.advance(10);
  assert.equal(a.maxHp, 150); assert.equal(a.hp, 150); assert.equal(a.healing, 130);
  assert.equal(Math.hypot(a.vx, a.vy), 337.5); assert.equal(a.items.ascended, true);
  assert.equal(events.filter(e => e.effect === 'ascension' && e.kind === 'item').length, 1);
  a.hp = 130; battle.advance(1000); assert.equal(a.hp, 130); assert.equal(a.maxHp, 150);
});

test('ascension boosts outgoing and self damage by two, stacks world rewards, and never boosts deferred installments twice', () => {
  const { battle, a, b, deal } = setup(['ascension-charm'], ['pain-installment']);
  a.items.ascended = true; a.world.damageBonus = 5;
  deal(10, 0, 1); assert.equal(b.hp, 91); assert.equal(b.items.debts[0].remaining, 8);
  battle.advance(4000); assert.equal(b.hp, 83); assert.equal(a.damageDealt, 17);
  deal(4, 0, 0, 'self-damage'); assert.equal(a.hp, 94);
  deal(3, 0, 0, 'arena-damage'); assert.equal(a.hp, 91);
});

test('healing orb first ticks at 5s, repeats at 10s, and records only effective healing', () => {
  const { battle, a } = setup(['healing-orb']); a.hp = 95;
  battle.advance(4990); assert.equal(a.hp, 95); battle.advance(10); assert.equal(a.hp, 97);
  battle.advance(5000); assert.equal(a.hp, 99); battle.advance(5000); assert.equal(a.hp, 100); assert.equal(a.healing, 5);
});

test('instant healing at the five-minute boundary settles before timeout, then stops permanently', () => {
  const { battle, a } = setup(['healing-orb']); a.hp = 10; a.maxHp = 1000;
  battle.advance(299_990); assert.equal(a.hp, 128);
  const last = battle.advance(10);
  assert.equal(a.hp, 130); assert.equal(a.healing, 120); assert.equal(battle.snapshot().finished, true);
  assert.ok(last.findIndex(e => e.effect === 'regen') < last.findIndex(e => e.kind === 'end'));
  assert.deepEqual(battle.advance(5000), []);
});

test('new item combinations replay identically across seats/chunks and preserve damage accounting', () => {
  const ids = ITEMS.slice(9).map(item => item.id);
  const players = ['a', 'b'].map(id => ({ id, name: id, loadout: { ...createDefaultLoadout(), items: id === 'a' ? ids.slice(0, 3) : [...ids.slice(3), 'pain-installment'] } }));
  const one = new BattleSimulator(players, 199), two = new BattleSimulator([...players].reverse(), 199);
  const events = one.advance(190_000), other: BattleEvent[] = [];
  for (let i = 0; i < 1900; i++) other.push(...two.advance(100));
  assert.deepEqual(events, other); assert.deepEqual(one.snapshot(), two.snapshot());
  for (const fighter of one.snapshot().fighters) {
    const amount = events.filter(e => e.sourceId === fighter.id && e.targetId !== fighter.id && ['attack', 'slap', 'drain', 'item-damage', 'installment', 'refund', 'combo', 'reflection'].includes(e.kind)).reduce((sum, e) => sum + e.amount, 0);
    assert.equal(fighter.damageDealt, amount);
  }
});
