import assert from 'node:assert/strict';
import test from 'node:test';
import { BattleSimulator } from '../server/battle.js';
import type { ItemFighter } from '../server/battle-items.js';
import { createDefaultLoadout } from '../shared/catalog.js';
import { LIANG_YIELD_QUOTES } from '../shared/liangchushuo.js';
import type { BattleEvent, DamageKind, PetId } from '../shared/types.js';

interface Internals {
  fighters: (ItemFighter & { attack: number })[];
  damage(events: BattleEvent[], source: ItemFighter, target: ItemFighter, amount: number, kind: DamageKind, label: string): number;
}
function setup(opponent?: PetId, items: string[] = [], enemyItems: string[] = []) {
  const players = ['a', 'b'].map((id, i) => ({ id, name: id, loadout: { ...createDefaultLoadout(), petId: (i ? opponent ?? 'liangchushuo' : 'liangchushuo') as PetId, items: i ? enemyItems : items } }));
  const battle = new BattleSimulator(players, 7);
  const internal = battle as unknown as Internals;
  const [a, b] = internal.fighters.map(f => f.state);
  if (!opponent) b.liang = null; // Neutral opponent for exact numerical boundaries.
  function apart() { Object.assign(a, { x: 100, y: 100, vx: 0, vy: 0 }); Object.assign(b, { x: 100, y: 320, vx: 0, vy: 0 }); battle.advance(10); }
  apart();
  function contact() {
    Object.assign(a, { x: 177, y: 210, vx: 300, vy: 0 });
    Object.assign(b, { x: 243, y: 210, vx: -300, vy: 0 });
    return battle.advance(10);
  }
  function deal(amount: number, kind: DamageKind, target = 0) {
    const events: BattleEvent[] = [];
    internal.damage(events, internal.fighters[1 - target], internal.fighters[target], amount, kind, '测试命中');
    return events;
  }
  return { battle, players, a, b, apart, contact, deal, internal };
}

test('Liang starts yielding and alternates two contacts: 26 outgoing, 16 incoming', () => {
  const { battle, a, b, apart, contact } = setup();
  assert.deepEqual(battle.snapshot().fighters[0].liang, { phase: 'yield', contact: null });
  const first = contact();
  assert.equal(a.hp, 94); assert.equal(b.hp, 90); assert.equal(a.liang!.phase, 'return');
  assert.equal(first.find(e => e.kind === 'courtesy' && e.amount > 0)!.amount, 4);
  assert.ok(LIANG_YIELD_QUOTES.includes(a.liang!.contact!.quote as typeof LIANG_YIELD_QUOTES[number]));
  apart(); const second = contact();
  assert.equal(a.hp, 84); assert.equal(b.hp, 74); assert.equal(a.damageDealt, 26); assert.equal(b.damageDealt, 16);
  assert.equal(a.liang!.phase, 'yield'); assert.equal(a.liang!.contact!.quote, '必须的');
  assert.equal(second.find(e => e.kind === 'attack' && e.sourceId === a.id)!.effect, 'liang-return');
  const cloned = battle.snapshot(); cloned.fighters[0].liang!.phase = 'return';
  assert.equal(a.liang!.phase, 'yield', 'snapshots never mutate live state');
});

test('yield floors damage at zero and reports only the available reduction', () => {
  const { a, b, internal, contact } = setup(); internal.fighters[1].attack = 2;
  const events = contact();
  assert.equal(a.hp, 100); assert.equal(b.damageDealt, 0); assert.equal(a.liang!.phase, 'return');
  assert.equal(events.find(e => e.kind === 'courtesy' && e.amount > 0)!.amount, 2);
  assert.equal(events.find(e => e.kind === 'attack' && e.targetId === a.id)!.amount, 0);
});

test('blocked damage still consumes both phases and does not claim actual mitigation', () => {
  const { a, b, contact, apart } = setup();
  a.world.invulnerableUntilMs = b.world.invulnerableUntilMs = 1000;
  const first = contact(); assert.equal(a.hp, 100); assert.equal(b.hp, 100);
  assert.equal(a.liang!.phase, 'return'); assert.equal(first.some(e => e.kind === 'courtesy' && e.amount > 0), false);
  apart(); contact(); assert.equal(a.liang!.phase, 'yield'); assert.equal(a.damageDealt, 0);
});

test('stunned Liang still advances and consumes a return without producing an attack', () => {
  const { a, b, contact, apart } = setup(); a.world.stunnedUntilMs = 1000;
  contact(); assert.equal(a.hp, 94); assert.equal(b.hp, 100); assert.equal(a.liang!.phase, 'return');
  apart(); const events = contact();
  assert.equal(a.hp, 84); assert.equal(b.hp, 100); assert.equal(a.liang!.phase, 'yield');
  assert.equal(a.liang!.contact!.quote, '必须的'); assert.equal(events.some(e => e.kind === 'attack' && e.sourceId === a.id), false);
});

test('mirror phases are captured before damage and same-contact lethal returns can draw', () => {
  const { battle, a, b, contact } = setup('liangchushuo');
  a.liang!.phase = b.liang!.phase = 'return'; a.hp = b.hp = 16;
  const events = contact();
  assert.deepEqual([a.hp, b.hp, a.damageDealt, b.damageDealt], [0, 0, 16, 16]);
  assert.equal(battle.snapshot().draw, true); assert.equal(events.filter(e => e.kind === 'attack').length, 2);
  assert.deepEqual(battle.advance(1000), []);
});

test('opposite mirror phases combine return and yield exactly once', () => {
  const { a, b, contact } = setup('liangchushuo'); a.liang!.phase = 'return';
  contact(); assert.deepEqual([a.hp, b.hp], [90, 88]);
  assert.deepEqual([a.liang!.phase, b.liang!.phase], ['yield', 'return']);
});

test('non-contact damage never receives Liang modifiers or advances the phase', () => {
  for (const kind of ['slap', 'drain', 'item-damage', 'installment', 'refund', 'arena-damage', 'combo', 'reflection', 'self-damage'] as const) {
    const { a, b, deal } = setup('liangchushuo'); b.liang!.phase = 'return';
    const events = deal(8, kind);
    assert.equal(a.hp, 92, kind); assert.equal(events.find(e => e.kind === kind)!.amount, 8);
    assert.equal(a.liang!.phase, 'yield'); assert.equal(b.liang!.phase, 'return'); assert.equal(a.liang!.contact, null);
  }
});

test('world and item bonuses precede yield, then installment and refund use the reduced actual amount', () => {
  const { battle, a, b, contact, apart } = setup(undefined, ['pain-installment', 'refund-code']);
  b.world.damageBonus = 3; b.items.ascended = true; // 10 + 3 + 2 - 4 = 11, then 6 now / 5 deferred.
  contact(); assert.equal(a.hp, 94); assert.equal(a.items.debts[0].remaining, 5); assert.equal(a.items.refundAmount, 6);
  assert.equal(b.damageDealt, 6);
  apart(); battle.advance(4000);
  assert.equal(a.hp, 89); assert.equal(a.items.debts.length, 0); assert.equal(a.liang!.phase, 'return');
});

test('return bonus is included before installment and is not re-applied to its payments', () => {
  const { battle, a, b, contact, apart } = setup(undefined, [], ['pain-installment']); a.liang!.phase = 'return';
  contact(); assert.equal(b.hp, 92); assert.equal(b.items.debts[0].remaining, 8);
  apart(); battle.advance(4000); assert.equal(b.hp, 84); assert.equal(a.damageDealt, 16);
});

test('staff extra hits remain independent item damage and never duplicate return bonus or yield reduction', () => {
  const { a, b, contact } = setup('liangchushuo', ['plain-club']);
  a.liang!.phase = 'return'; a.items.staffAwakened = true; b.hp = b.maxHp = 1000;
  const events = contact();
  assert.equal(events.find(e => e.kind === 'attack' && e.sourceId === a.id)!.amount, 15); // 10+3+6-4
  const combo = events.filter(e => e.kind === 'combo'); assert.ok(combo.length > 0);
  assert.ok(combo.every(e => e.amount === 13));
  assert.equal(b.liang!.phase, 'return');
});

test('rewind restores life without rolling back courtesy phase or latest quote', () => {
  const { a, b, contact, apart } = setup(undefined, ['rewind-tape']); a.hp = 12;
  const events = contact(); assert.equal(a.hp, 100); assert.equal(a.items.rewindUsed, true); assert.equal(a.liang!.phase, 'return');
  assert.equal(b.damageDealt, 6); assert.equal(events.some(e => e.kind === 'rewind'), true);
  apart(); contact(); assert.equal(a.liang!.contact!.quote, '必须的'); assert.equal(a.liang!.phase, 'yield');
});

test('binding and continuous contact do not manufacture additional courtesy activations', () => {
  const { battle, a, b } = setup('chengzhiquan');
  Object.assign(a, { x: 178, y: 210, vx: 0, vy: 0 }); Object.assign(b, { x: 242, y: 210, vx: 0, vy: 0 });
  a.boundUntilMs = b.boundUntilMs = 3010;
  b.cheng!.grapple = { targetId: a.id, startedAtMs: 10, ticks: 0 };
  const events = battle.advance(3020);
  assert.equal(events.filter(e => e.kind === 'drain').length, 3);
  assert.equal(events.some(e => e.kind === 'courtesy'), false);
  assert.equal(a.liang!.contact, null);
  assert.equal(a.liang!.phase, 'yield');
});

test('wall bounces and elapsed time alone do not advance courtesy', () => {
  const { battle, a } = setup(); Object.assign(a, { x: 33, y: 100, vx: -300, vy: 0 });
  battle.advance(1000); assert.ok(a.wallBounces > 0); assert.equal(a.liang!.phase, 'yield'); assert.equal(a.liang!.contact, null);
});

test('lethal mitigation allows a zero-health boundary without revival and statistics cap overkill', () => {
  const { battle, a, b, contact } = setup(); a.hp = 6; b.hp = 1;
  contact(); assert.equal(a.hp, 0); assert.equal(b.hp, 0); assert.equal(a.damageDealt, 1); assert.equal(b.damageDealt, 6);
  assert.equal(battle.snapshot().draw, true);
});

test('seeded matches stay identical across chunk sizes and reversed seating, including quotes', () => {
  const { players } = setup('liangchushuo');
  const one = new BattleSimulator(players, 5), chunked = new BattleSimulator([...players].reverse(), 5);
  const expected = one.advance(40_000), actual: BattleEvent[] = [];
  for (let t = 0; t < 40_000; t += 100) actual.push(...chunked.advance(100));
  assert.deepEqual(actual, expected); assert.deepEqual(chunked.snapshot(), one.snapshot());
  assert.ok(expected.some(e => e.kind === 'courtesy' && e.text.includes('必须的')));
});
