import assert from 'node:assert/strict';
import test from 'node:test';
import { BattleSimulator } from '../server/battle.js';
import type { ItemFighter } from '../server/battle-items.js';
import { ARENA_SIZE, ITEMS, PETS, createDefaultLoadout } from '../shared/catalog.js';
import type { BattleEvent, DamageKind, FighterState, ItemFieldState, PetId } from '../shared/types.js';

// Repositioning and direct damage are deterministic test fixtures only; neither
// is exposed through room messages or the production simulator API.
interface Internals {
  fighters: ItemFighter[];
  items: { field: ItemFieldState };
  damage(events: BattleEvent[], source: ItemFighter, target: ItemFighter, amount: number, kind: DamageKind, label: string): number;
}
function setup(aItems: string[] = [], bItems: string[] = [], aPet: PetId = 'liangchushuo', bPet: PetId = 'liangchushuo', seed = 7) {
  const players = ['a', 'b'].map((id, i) => ({ id, name: id, loadout: { ...createDefaultLoadout(), petId: i ? bPet : aPet, items: i ? bItems : aItems } }));
  const battle = new BattleSimulator(players, seed);
  const initial = battle.snapshot();
  const internal = battle as unknown as Internals;
  const [a, b] = internal.fighters.map(f => f.state);
  a.liang = b.liang = null; // Isolate item/world rules from character effects.
  Object.assign(a, { x: 100, y: 100, vx: 0, vy: 0 });
  Object.assign(b, { x: 100, y: 320, vx: 0, vy: 0 });
  if (a.cheng) a.cheng.nextMealAtMs = Infinity;
  if (b.cheng) b.cheng.nextMealAtMs = Infinity;
  const deal = (amount: number, target = 0, kind: DamageKind = 'attack') => {
    const events: BattleEvent[] = [];
    internal.damage(events, internal.fighters[1 - target], internal.fighters[target], amount, kind, '测试命中');
    return events;
  };
  return { battle, initial, internal, a, b, deal };
}
function contact(battle: BattleSimulator, a: FighterState, b: FighterState) {
  const gap = a.radius + b.radius;
  Object.assign(a, { x: 210 - gap / 2 - 1, y: 210, vx: 300, vy: 0 });
  Object.assign(b, { x: 210 + gap / 2 + 1, y: 210, vx: -300, vy: 0 });
  return battle.advance(10);
}
function apart(battle: BattleSimulator, a: FighterState, b: FighterState) {
  Object.assign(a, { x: 100, y: 100, vx: 0, vy: 0 });
  Object.assign(b, { x: 100, y: 320, vx: 0, vy: 0 });
  battle.advance(10);
}
function bounce(battle: BattleSimulator, a: FighterState, count: number) {
  for (let i = 0; i < count; i++) { Object.assign(a, { x: a.radius + 1, y: 100, vx: -300, vy: 0 }); battle.advance(10); }
}

test('banana arms after its owner leaves, can trip its owner and doubles speed for exactly one second', () => {
  const { battle, a } = setup(['banana-peel']);
  bounce(battle, a, 3);
  const peel = battle.snapshot().field.bananas[0];
  assert.equal(peel.expiresAtMs, 20_030); assert.equal(peel.armed, false);
  Object.assign(a, { x: 140, vx: 0 }); battle.advance(10);
  assert.equal(battle.snapshot().field.bananas[0].armed, true);
  Object.assign(a, { x: peel.x, y: peel.y, vx: 300 });
  assert.ok(battle.advance(10).some(e => e.text.includes('自己扔的')));
  assert.equal(battle.snapshot().field.bananas.length, 0);
  assert.equal(Math.hypot(a.vx, a.vy), 600);
  battle.advance(990); assert.equal(a.items.slipUntilMs, 1050);
  battle.advance(10); assert.equal(a.items.slipUntilMs, 0);
  assert.equal(Math.hypot(a.vx, a.vy), 300);
});

test('banana survives until 20 seconds after creation, then expires before pickup', () => {
  const { battle, a } = setup(['banana-peel']); bounce(battle, a, 3);
  Object.assign(a, { x: 200, vx: 0 }); battle.advance(19_990);
  assert.equal(battle.snapshot().field.bananas.length, 1);
  battle.advance(10); assert.equal(battle.snapshot().field.bananas.length, 0);
});

test('toilet warns at ten seconds and relocates only after 500ms, pointing inward at a legal corner', () => {
  const { battle, a } = setup(['emergency-toilet']);
  battle.advance(10_000); assert.equal(a.items.teleportStartedAtMs, 10_000);
  battle.advance(490); assert.equal(a.x, 100);
  battle.advance(10);
  assert.equal(a.items.teleportStartedAtMs, null); assert.equal(a.items.positionRevision, 1);
  assert.ok([36, 384].includes(a.x)); assert.ok([36, 384].includes(a.y));
  assert.ok(a.x < 210 ? a.vx > 0 : a.vx < 0); assert.ok(a.y < 210 ? a.vy > 0 : a.vy < 0);
  assert.ok(Math.abs(Math.hypot(a.vx, a.vy) - 300) < 1e-6);
});

test('toilet and pump wait through a real Cheng bind without moving either ball', () => {
  const { battle, a, b } = setup(['emergency-toilet', 'overinflator'], [], 'liangchushuo', 'chengzhiquan');
  battle.advance(9500);
  b.cheng!.grapple = { targetId: a.id, startedAtMs: 9500, ticks: 0 };
  a.boundUntilMs = b.boundUntilMs = 12_500;
  battle.advance(2990);
  assert.deepEqual([a.x, a.y, b.x, b.y], [100, 100, 100, 320]);
  assert.equal(a.radius, 32); assert.equal(a.items.teleportStartedAtMs, 10_000);
  battle.advance(10); assert.equal(a.items.teleportStartedAtMs, null);
  battle.advance(10); assert.equal(a.radius, 48);
});

test('pump changes actual collision radius and movement speed, then restores both at four seconds', () => {
  const { battle, a } = setup(['overinflator']); a.vx = 300;
  battle.advance(11_990); assert.equal(a.radius, 32);
  battle.advance(10); assert.equal(a.radius, 48); assert.equal(Math.hypot(a.vx, a.vy), 225);
  assert.ok(a.x >= 48 && a.x <= 372);
  battle.advance(3990); assert.equal(a.radius, 48);
  battle.advance(10); assert.equal(a.radius, 32); assert.equal(Math.hypot(a.vx, a.vy), 300);
});

test('wall punch warns for 700ms, hits its owner once, knocks back and does not count as ball contact', () => {
  const { battle, a } = setup(['wall-punch']); bounce(battle, a, 4);
  const punch = battle.snapshot().field.punches[0]; assert.equal(punch.launchAtMs, 740);
  Object.assign(a, { x: 60, vx: 0 });
  battle.advance(690); assert.equal(a.hp, 100);
  const events = battle.advance(10);
  assert.equal(a.hp, 88); assert.equal(a.hits, 0); assert.equal(a.damageDealt, 0);
  assert.ok(a.x >= 84); assert.equal(battle.snapshot().field.punches.length, 0);
  assert.equal(events.filter(e => e.kind === 'item-damage' && e.effect === 'punch').length, 1);
});

test('bomb starts at twenty seconds and deals thirty damage to its current holder', () => {
  const { battle, a } = setup(['bomb-parcel']);
  assert.equal(battle.snapshot().field.bombs[0].explodesAtMs, 20_000);
  battle.advance(19_990); assert.equal(a.hp, 100);
  const events = battle.advance(10); assert.equal(a.hp, 70);
  assert.equal(events.find(e => e.kind === 'item-damage')?.amount, 30);
  assert.equal(battle.snapshot().field.bombs.length, 0);
});

test('real contact passes the parcel without resetting its fuse and attributes enemy damage to its owner', () => {
  const { battle, a, b } = setup(['bomb-parcel']); contact(battle, a, b);
  assert.deepEqual(battle.snapshot().field.bombs.map(bomb => [bomb.holderId, bomb.explodesAtMs]), [['b', 20_000]]);
  apart(battle, a, b); battle.advance(19_980);
  assert.equal(b.hp, 60); assert.equal(a.hp, 90); assert.equal(a.damageDealt, 40);
});

test('both parcels exchange simultaneously and same-time bomb deaths can draw', () => {
  const { battle, a, b } = setup(['bomb-parcel'], ['bomb-parcel']);
  contact(battle, a, b);
  assert.deepEqual(battle.snapshot().field.bombs.map(bomb => bomb.holderId), ['b', 'a']);
  apart(battle, a, b); a.hp = b.hp = 30;
  const events = battle.advance(19_980);
  assert.equal(events.filter(e => e.kind === 'item-damage' && e.amount === 30).length, 2);
  assert.equal(battle.snapshot().draw, true); assert.deepEqual([a.hp, b.hp], [0, 0]);
});

test('installments preserve the complete damage total, charging four times without recursively splitting', () => {
  const { battle, a, b, deal } = setup(['pain-installment']);
  deal(11); assert.equal(a.hp, 94); assert.equal(a.items.debts[0].remaining, 5); assert.equal(b.damageDealt, 6);
  const events: BattleEvent[] = [];
  for (const hp of [92, 91, 90, 89]) { events.push(...battle.advance(1000)); assert.equal(a.hp, hp); }
  assert.deepEqual(events.filter(e => e.kind === 'installment').map(e => e.amount), [2, 1, 1, 1]);
  assert.equal(a.items.debts.length, 0); assert.equal(b.damageDealt, 11);
});

test('invulnerability and Cheng lethal protection prevent both immediate damage and its debt', () => {
  const { a, b, deal } = setup(['pain-installment', 'refund-code'], [], 'chengzhiquan');
  a.cheng!.invulnerableUntilMs = 1000; deal(30);
  assert.equal(a.hp, 120); assert.equal(a.items.debts.length, 0); assert.equal(a.items.refundAmount, 0);
  a.cheng!.invulnerableUntilMs = 0; a.hp = 5;
  deal(30); assert.equal(a.hp, 5); assert.equal(a.cheng!.survivalUsed, true);
  assert.equal(a.items.debts.length, 0); assert.equal(b.damageDealt, 0);
});

test('installment payments can kill and all outstanding objects and payments stop at the result', () => {
  const { battle, a, deal } = setup(['pain-installment', 'bomb-parcel']);
  a.hp = 3; deal(4); assert.equal(a.hp, 1);
  battle.advance(1000); assert.equal(a.hp, 0); assert.equal(battle.snapshot().finished, true);
  assert.deepEqual(battle.snapshot().field, { bananas: [], punches: [], pearls: [], bombs: [] });
  assert.deepEqual(a.items.debts, []); assert.deepEqual(battle.advance(60_000), []);
});

test('refund requires a later contact, only returns actual immediate damage and does not recursively print codes', () => {
  const { battle, a, b, deal } = setup(['refund-code']);
  const first = contact(battle, a, b); assert.equal(first.some(e => e.kind === 'refund'), false);
  assert.equal(a.items.refundAmount, 10);
  apart(battle, a, b);
  const second = contact(battle, a, b);
  assert.deepEqual(second.filter(e => e.kind === 'refund').map(e => e.amount), [10]);
  assert.deepEqual([a.hp, b.hp], [80, 70]); assert.equal(a.items.refundAmount, 0);
  a.items.nextRefundAtMs = 0; deal(4, 0, 'refund'); assert.equal(a.items.refundAmount, 0);
});

test('refund expires at three seconds and remains on cooldown until ten seconds', () => {
  const { battle, a, deal } = setup(['refund-code']); deal(12);
  battle.advance(3000); assert.equal(a.items.refundAmount, 0);
  deal(1); assert.equal(a.items.refundAmount, 0);
  battle.advance(7000); deal(5); assert.equal(a.items.refundAmount, 5);
});

test('pearls first spawn at twenty seconds, full HP does not consume them, either player heals 15% of their own maximum', () => {
  const { battle, a, b, internal } = setup(['pearl-cup'], [], 'liangchushuo', 'chengzhiquan');
  battle.advance(19_990); assert.equal(battle.snapshot().field.pearls.length, 0);
  battle.advance(10); assert.equal(battle.snapshot().field.pearls.length, 3);
  const pearl = internal.items.field.pearls[0];
  Object.assign(a, { x: pearl.x, y: pearl.y });
  Object.assign(b, { x: pearl.x < 210 ? 380 : 40, y: pearl.y < 210 ? 380 : 40 });
  battle.advance(10); assert.equal(internal.items.field.pearls.length, 3);
  // Isolate one pearl to make simultaneous nearby pickups irrelevant to this boundary check.
  internal.items.field.pearls = [pearl]; a.hp = 50;
  battle.advance(10); assert.equal(a.hp, 65); assert.equal(a.healing, 15);
  internal.items.field.pearls = [{ ...pearl, id: 999, x: b.x, y: b.y }]; b.hp = 60;
  battle.advance(10); assert.equal(b.hp, 78); assert.equal(b.healing, 18);
  internal.items.field.pearls = [{ ...pearl, id: 1000, x: b.x, y: b.y }]; b.hp = 115;
  battle.advance(10); assert.equal(b.hp, 120); assert.equal(b.healing, 23);
});

test('unclaimed pearls expire exactly ten seconds after spawning and spawn again on the next twenty-second interval', () => {
  const { battle } = setup(['pearl-cup']); battle.advance(20_000);
  assert.ok(battle.snapshot().field.pearls.every(pearl => pearl.expiresAtMs === 30_000));
  battle.advance(9990); assert.equal(battle.snapshot().field.pearls.length, 3);
  battle.advance(10); assert.equal(battle.snapshot().field.pearls.length, 0);
  battle.advance(10_000); assert.equal(battle.snapshot().field.pearls.length, 3);
});

test('rewind triggers strictly below ten HP and restores three-second-old HP, position and direction once', () => {
  const { battle, a, deal } = setup(['rewind-tape']);
  a.hp = 80; battle.advance(3010);
  Object.assign(a, { x: 250, y: 100, hp: 20, nostalgiaUsed: true });
  deal(10); assert.equal(a.hp, 10); assert.equal(a.items.rewindUsed, false);
  const events = deal(1);
  assert.equal(a.hp, 80); assert.equal(a.x, 100); assert.equal(a.y, 100);
  assert.equal(a.healing, 71); assert.equal(a.items.rewindUsed, true); assert.equal(a.items.positionRevision, 1);
  assert.equal(a.nostalgiaUsed, true); assert.equal(events.find(e => e.kind === 'rewind')?.amount, 71);
  a.hp = 10; deal(1); assert.equal(a.hp, 9);
});

test('early rewind uses the initial frame, lethal damage does not revive', () => {
  const early = setup(['rewind-tape']); early.a.hp = 20; early.deal(12);
  assert.equal(early.a.hp, 100); assert.equal(early.a.x, early.initial.fighters[0].x);
  const lethal = setup(['rewind-tape']); lethal.a.hp = 9; lethal.deal(10);
  assert.equal(lethal.a.hp, 0); assert.equal(lethal.a.items.rewindUsed, false);
  lethal.battle.advance(10); assert.equal(lethal.battle.snapshot().finished, true);
});

test('rewind retains current skill uses, invulnerability state, item clocks and unpaid installments', () => {
  const { battle, a, deal } = setup(['rewind-tape', 'pain-installment', 'bomb-parcel'], [], 'chengzhiquan');
  a.hp = 80; battle.advance(3010);
  Object.assign(a.cheng!, { survivalUsed: true, grappleUnlocked: true, nextGrappleAtMs: 999_000, meals: 5 });
  a.hp = 14; deal(12);
  assert.equal(a.hp, 80); assert.equal(a.items.debts[0].remaining, 6);
  assert.equal(a.cheng!.survivalUsed, true); assert.equal(a.cheng!.grappleUnlocked, true); assert.equal(a.cheng!.meals, 5);
  assert.equal(a.cheng!.nextGrappleAtMs, 999_000); assert.equal(battle.snapshot().field.bombs[0].explodesAtMs, 20_000);
});

test('rewind restores life during a bind but queues relocation until both balls are released', () => {
  const { battle, a, b, deal } = setup(['rewind-tape'], [], 'liangchushuo', 'chengzhiquan');
  a.hp = 80; battle.advance(3010); a.x = 150;
  b.cheng!.grapple = { targetId: a.id, startedAtMs: 3010, ticks: 0 };
  a.boundUntilMs = b.boundUntilMs = 6010;
  a.hp = 18; deal(10);
  assert.equal(a.hp, 80); assert.equal(a.x, 150); assert.ok(a.items.rewindPosition);
  battle.advance(2990); assert.equal(a.x, 150); assert.equal(b.y, 320);
  battle.advance(20); assert.equal(a.items.rewindPosition, null); assert.equal(a.x, 100);
});

test('field, equipped lists and debt records in snapshots cannot mutate the authoritative state', () => {
  const { battle, a, deal } = setup(['pain-installment', 'bomb-parcel']); deal(20);
  const snapshot = battle.snapshot(); snapshot.fighters[0].items.debts[0].remaining = 999;
  snapshot.fighters[0].items.equipped.length = 0; snapshot.field.bombs[0].holderId = 'invented';
  assert.equal(a.items.debts[0].remaining, 10); assert.equal(a.items.equipped.length, 2);
  assert.equal(battle.snapshot().field.bombs[0].holderId, 'a');
});

test('item simulation is deterministic across chunking and player input order', () => {
  const players = ['a', 'b'].map((id, index) => ({ id, name: id, loadout: { ...createDefaultLoadout(), petId: 'chengzhiquan' as const, items: ITEMS.slice(index, index + 3).map(item => item.id) } }));
  const one = new BattleSimulator(players, 117), two = new BattleSimulator([...players].reverse(), 117);
  const events = one.advance(60_000), chunked: BattleEvent[] = [];
  for (let i = 0; i < 600; i++) chunked.push(...two.advance(100));
  assert.deepEqual(events, chunked); assert.deepEqual(one.snapshot(), two.snapshot());
});

test('three-item combinations remain finite, bounded and preserve damage/healing accounting for every character pairing', () => {
  for (const first of PETS) for (const second of PETS) {
    const players = ['a', 'b'].map((id, i) => ({ id, name: id, loadout: { ...createDefaultLoadout(), petId: i ? second.id : first.id, items: ITEMS.slice(i, i + 3).map(item => item.id) } }));
    const battle = new BattleSimulator(players, 19);
    const events: BattleEvent[] = [];
    for (let i = 0; i < 180 && !battle.snapshot().finished; i++) {
      events.push(...battle.advance(500));
      for (const fighter of battle.snapshot().fighters) {
        assert.ok([fighter.x, fighter.y, fighter.vx, fighter.vy, fighter.hp].every(Number.isFinite));
        assert.ok(fighter.x >= fighter.radius - 1e-6 && fighter.x <= ARENA_SIZE - fighter.radius + 1e-6, `${first.id}/${second.id} x=${fighter.x} r=${fighter.radius}`);
        assert.ok(fighter.y >= fighter.radius - 1e-6 && fighter.y <= ARENA_SIZE - fighter.radius + 1e-6);
        assert.ok(fighter.hp >= 0 && fighter.hp <= fighter.maxHp);
      }
    }
    for (const fighter of battle.snapshot().fighters) {
      const damage = events.filter(e => e.sourceId === fighter.id && e.targetId !== fighter.id && ['attack', 'slap', 'drain', 'item-damage', 'installment', 'refund'].includes(e.kind)).reduce((sum, e) => sum + e.amount, 0);
      const healing = events.filter(e => e.targetId === fighter.id && (e.kind === 'heal' || (e.kind === 'rewind' && e.amount > 0))).reduce((sum, e) => sum + e.amount, 0);
      assert.equal(fighter.damageDealt, damage); assert.equal(fighter.healing, healing);
    }
  }
});
