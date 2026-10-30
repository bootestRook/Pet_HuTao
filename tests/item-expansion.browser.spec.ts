import { test, expect, type Page } from '@playwright/test';
import { Client, type Room } from '@colyseus/sdk';
import { build } from 'vite';
import { resolve } from 'node:path';
import { BattleSimulator } from '../server/battle.js';
import { createDefaultLoadout } from '../shared/catalog.js';
import type { BattleEvent, RoomSnapshot } from '../shared/types.js';

const newIds = ['lucky-ticket', 'plain-club', 'thorn-armor', 'ascension-charm', 'healing-orb'];
async function equip(page: Page, ids = ['lucky-ticket', 'thorn-armor', 'healing-orb']) {
  await page.locator('[data-candidate="chengzhiquan"]').click(); await page.locator('#equip-candidate').click();
  await page.locator('#catalog-tabs [data-category="items"]').click();
  await expect(page.locator('#catalog-grid [data-candidate]')).toHaveCount(14);
  for (const id of ids) {
    await page.locator(`[data-candidate="${id}"]`).click(); await page.locator('#equip-candidate').click();
  }
  await expect(page.locator('#equipped-count')).toHaveText('3 / 3');
}

test('three-item combinations equip, trade reflections, heal and roll tickets on synchronized desktop/mobile with refresh', async ({ browser, baseURL }, testInfo) => {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const host = await desktop.newPage(), guest = await mobile.newPage();
  const states: RoomSnapshot[] = [], events = new Map<number, BattleEvent>(), errors: string[] = [];
  let viewer: Room | undefined;
  for (const page of [host, guest]) page.on('pageerror', error => errors.push(error.message));
  try {
    await host.goto(baseURL!); await host.getByLabel('你的昵称').fill('幸运甲');
    await host.getByRole('button', { name: '创建房间', exact: true }).click(); await expect(host.locator('#room')).toBeVisible();
    const roomId = (await host.locator('#room-id').textContent())!; await equip(host);
    await host.locator('[data-candidate="plain-club"]').click(); await expect(host.locator('#detail-description')).toContainText('1%');
    await guest.goto(`${baseURL}/?room=${roomId}`); await guest.getByLabel('你的昵称').fill('幸运乙');
    await guest.getByRole('button', { name: '加入', exact: true }).click(); await expect(guest.locator('#room')).toBeVisible(); await equip(guest, ['plain-club', 'ascension-charm', 'healing-orb']);
    await guest.screenshot({ path: testInfo.outputPath('new-items-catalog-mobile.png'), fullPage: true });
    viewer = await new Client(baseURL!).joinById(roomId, { name: '新道具观众' });
    viewer.onMessage('snapshot', (state: RoomSnapshot) => { states.push(state); for (const event of state.events) events.set(event.seq, event); });
    viewer.onMessage('clock', () => {}); viewer.onMessage('error', value => errors.push(JSON.stringify(value))); viewer.send('sync');
    await expect.poll(() => states.at(-1)?.players.map(p => p.loadout.items.length)).toEqual([3, 3]);
    await host.locator('#ready').click(); await guest.locator('#ready').click();
    await expect.poll(() => states.at(-1)?.battle?.fighters.filter(f => f.items.equipped.includes('lucky-ticket')).every(f => f.items.ticketRolls >= 1), { timeout: 20_000 }).toBe(true);
    await expect.poll(() => [...events.values()].some(e => e.kind === 'reflection'), { timeout: 60_000 }).toBe(true);
    await expect.poll(() => [...events.values()].some(e => e.kind === 'heal' && e.effect === 'regen'), { timeout: 30_000 }).toBe(true);
    await expect(host.locator('#player-1 .fighter-items')).toContainText('飞升');
    const old = states.at(-1)!.battle!.fighters.map(f => [f.id, f.items.staffAwakened, f.items.nextTicketAtMs]);
    await guest.reload(); await expect(guest.locator('#room-id')).toHaveText(roomId);
    await expect(guest.locator('#player-1 .fighter-items')).toContainText('道具 3/3');
    expect(states.at(-1)!.battle!.fighters.map(f => [f.id, f.items.staffAwakened, f.items.nextTicketAtMs])).toEqual(old);
    for (const page of [host, guest]) expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await host.locator('.arena-panel').screenshot({ path: testInfo.outputPath('new-items-battle-desktop.png') });
    await guest.locator('.arena-panel').screenshot({ path: testInfo.outputPath('new-items-battle-mobile.png') });
    await testInfo.attach('new-item-snapshots', { body: JSON.stringify({ initial: states.find(s => s.battle)?.battle, latest: states.at(-1)?.battle, events: [...events.values()] }), contentType: 'application/json' });
    expect(errors).toEqual([]);
  } finally { await viewer?.leave().catch(() => {}); await desktop.close(); await mobile.close(); }
});

type ArtWindow = Window & { expansion: { renderer: { update(state: RoomSnapshot, events: BattleEvent[], reset?: boolean): void; destroy(): void }; colors: string[]; labels: { text: string; x: number; y: number; width: number }[] } };
test('rare staff, ascension, thorns, orb and harmless fireworks render at corners and in reduced motion', async ({ page, baseURL }, testInfo) => {
  const bundle = await build({ configFile: false, logLevel: 'silent', build: { write: false, minify: false, lib: { entry: resolve('client/arena.ts'), formats: ['es'] } } });
  const output = Array.isArray(bundle) ? bundle[0] : bundle; if (!('output' in output)) throw new Error('Missing renderer bundle');
  await page.route('**/expansion-fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: output.output.find(c => c.type === 'chunk')!.code }));
  await page.goto(baseURL!); await page.clock.install();
  const players = ['a', 'b'].map(id => ({ id, name: id, connected: true, ready: true, rematch: false, loadout: { ...createDefaultLoadout(), items: id === 'a' ? ['plain-club', 'ascension-charm', 'thorn-armor'] : ['lucky-ticket', 'healing-orb', 'plain-club'] } }));
  const battle = new BattleSimulator(players, 7).snapshot(); battle.elapsedMs = 180_000;
  const [a, b] = battle.fighters;
  Object.assign(a, { x: 100, y: 170, maxHp: 150, hp: 140, vx: 0, vy: 0 }); Object.assign(b, { x: 300, y: 280, hp: 70, vx: 0, vy: 0 });
  a.items.staffAwakened = a.items.ascended = true; b.items.staffAwakened = false;
  const state: RoomSnapshot = { roomId: 'expansion', matchId: 'expansion', phase: 'battle', players, spectators: [], availablePlayerSeats: 0, serverTime: 0, startAt: 0, events: [], battle };
  await page.evaluate(async () => {
    const url = '/expansion-fixture.js'; const { ArenaRenderer } = await import(url);
    const canvas = document.createElement('canvas'); canvas.id = 'expansion-fixture'; canvas.style.cssText = 'position:fixed;left:10px;top:10px;width:min(420px,calc(100vw - 20px));height:min(420px,calc(100vw - 20px));z-index:100'; document.body.append(canvas);
    const fixture: ArtWindow['expansion'] = { renderer: new ArenaRenderer(canvas), colors: [], labels: [] }; (window as unknown as ArtWindow).expansion = fixture;
    const ctx = canvas.getContext('2d')!;
    const rect = ctx.fillRect.bind(ctx); ctx.fillRect = (x, y, w, h) => { if (x === 0 && y === 0 && w === 420 && h === 420) { fixture.colors = []; fixture.labels = []; } rect(x, y, w, h); };
    const stroke = ctx.stroke.bind(ctx); ctx.stroke = ((...args: unknown[]) => { fixture.colors.push(String(ctx.strokeStyle)); Reflect.apply(stroke, ctx, args); }) as CanvasRenderingContext2D['stroke'];
    const text = ctx.fillText.bind(ctx); ctx.fillText = (label, x, y, width) => { fixture.labels.push({ text: label, x, y, width: ctx.measureText(label).width }); if (width === undefined) text(label, x, y); else text(label, x, y, width); };
  });
  const events: BattleEvent[] = [
    { seq: 1, timeMs: 180_000, kind: 'item', effect: 'lucky-ticket', sourceId: 'b', targetId: 'b', amount: 0, text: '烟花很好看', x: b.x, y: b.y },
    { seq: 2, timeMs: 180_000, kind: 'item', effect: 'ascension', sourceId: 'a', targetId: 'a', amount: 0, text: '飞升！', x: a.x, y: a.y },
    { seq: 3, timeMs: 180_000, kind: 'reflection', effect: 'thorns', sourceId: 'a', targetId: 'b', amount: 4, text: '反伤刺甲', x: b.x, y: b.y },
  ];
  const update = () => page.evaluate(({ state, events }) => (window as unknown as ArtWindow).expansion.renderer.update(state, events, true), { state, events });
  for (const motion of ['reduce', 'no-preference'] as const) {
    await page.emulateMedia({ reducedMotion: motion });
    for (const [x, y] of [[32, 32], [388, 32], [32, 388], [388, 388]]) {
      Object.assign(a, { x, y }); await update(); await page.clock.runFor(120);
      const frame = await page.evaluate(() => ({ colors: (window as unknown as ArtWindow).expansion.colors, labels: (window as unknown as ArtWindow).expansion.labels }));
      expect(frame.colors).toContain('#dbacff'); expect(frame.colors).toContain('#ac8253'); expect(frame.colors).toContain('#e9bdff');
      for (const label of frame.labels) { expect(label.x - label.width / 2).toBeGreaterThanOrEqual(0); expect(label.x + label.width / 2).toBeLessThanOrEqual(420); expect(label.y).toBeGreaterThanOrEqual(8); expect(label.y).toBeLessThanOrEqual(412); }
    }
  }
  Object.assign(a, { x: 110, y: 160 }); await update(); await page.clock.runFor(120);
  await page.locator('#expansion-fixture').screenshot({ path: testInfo.outputPath('new-items-art-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.clock.runFor(120);
  await page.locator('#expansion-fixture').screenshot({ path: testInfo.outputPath('new-items-art-mobile.png') });
  expect([a.hp, b.hp]).toEqual([140, 70]);
  await page.evaluate(() => (window as unknown as ArtWindow).expansion.renderer.destroy());
});
