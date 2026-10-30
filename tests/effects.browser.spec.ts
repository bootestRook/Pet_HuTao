import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { BattleSimulator } from '../server/battle.js';
import { createDefaultLoadout } from '../shared/catalog.js';
import type { BattleEvent, RoomSnapshot } from '../shared/types.js';

type Point = { x: number; y: number };
type DrawFrame = { balls: Point[]; labels: Record<string, Point>; palm: Point | null };
type EffectsWindow = Window & { effectsFixture: { frame: DrawFrame; renderer: { update(state: RoomSnapshot, events: BattleEvent[], reset?: boolean): void; destroy(): void } } };

test('slaps and floating damage/healing track their targets through interpolation and expire', async ({ page, baseURL }, testInfo) => {
  const built = await build({ configFile: false, logLevel: 'silent', build: { write: false, minify: false, lib: { entry: resolve('client/arena.ts'), formats: ['es'] } } });
  const output = Array.isArray(built) ? built[0] : built;
  if (!('output' in output)) throw new Error('Expected a renderer build');
  const code = output.output.find(chunk => chunk.type === 'chunk')!.code;
  await page.route('**/effects-renderer-fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: code }));
  await page.goto(baseURL!); await page.clock.install();
  const players = ['a', 'b'].map(id => ({ id, name: id, connected: true, ready: true, rematch: false, loadout: { ...createDefaultLoadout(), petId: 'hutao' as const } }));
  const battle = new BattleSimulator(players, 3).snapshot(); battle.elapsedMs = 1000;
  const snapshot: RoomSnapshot = { roomId: 'effects', matchId: 'effects', phase: 'battle', players, spectators: [], availablePlayerSeats: 0, serverTime: 0, startAt: 0, events: [], battle };
  await page.evaluate(async () => {
    const url = '/effects-renderer-fixture.js'; const { ArenaRenderer } = await import(url);
    const canvas = document.createElement('canvas'); canvas.id = 'effects-fixture';
    canvas.style.cssText = 'position:fixed;left:10px;top:10px;width:420px;height:420px;z-index:100'; document.body.append(canvas);
    const ctx = canvas.getContext('2d')!;
    const fixture: EffectsWindow['effectsFixture'] = { frame: { balls: [], labels: {}, palm: null }, renderer: new ArenaRenderer(canvas) };
    (window as unknown as EffectsWindow).effectsFixture = fixture;
    // Observe the actual canvas output: body centers, text coordinates and the hand's drawing transform.
    const fillRect = ctx.fillRect.bind(ctx);
    ctx.fillRect = (x, y, width, height) => { if (x === 0 && y === 0 && width === 420 && height === 420) fixture.frame = { balls: [], labels: {}, palm: null }; fillRect(x, y, width, height); };
    const arc = ctx.arc.bind(ctx);
    ctx.arc = (x, y, radius, start, end, counterclockwise) => { if (radius === 32) fixture.frame.balls.push({ x, y }); arc(x, y, radius, start, end, counterclockwise); };
    const fillText = ctx.fillText.bind(ctx);
    ctx.fillText = (label, x, y, maxWidth) => { fixture.frame.labels[label] = { x, y }; if (maxWidth === undefined) fillText(label, x, y); else fillText(label, x, y, maxWidth); };
    const fill = ctx.fill.bind(ctx);
    ctx.fill = ((...args: unknown[]) => {
      if (ctx.fillStyle === '#f3c69e') { const transform = ctx.getTransform(); const scale = canvas.width / 420; fixture.frame.palm = { x: transform.e / scale, y: transform.f / scale }; }
      Reflect.apply(fill, ctx, args);
    }) as CanvasRenderingContext2D['fill'];
  });
  const cases: { kind: BattleEvent['kind']; targetId: string; amount: number; label: string; effect?: 'nostalgia' }[] = [
    { kind: 'slap', targetId: 'b', amount: 8, label: '−8' },
    { kind: 'attack', targetId: 'b', amount: 10, label: '−10' },
    { kind: 'self-damage', targetId: 'a', amount: 4, label: '−4' },
    { kind: 'heal', targetId: 'a', amount: 12, label: '+12' },
    { kind: 'heal', targetId: 'a', amount: 25, label: '忆往昔 +25', effect: 'nostalgia' },
  ];
  for (const motion of ['reduce', 'no-preference'] as const) {
    await page.emulateMedia({ reducedMotion: motion });
    for (const entry of cases) {
      Object.assign(battle.fighters[0], { x: 100, y: 150, vx: 0, vy: 0 });
      Object.assign(battle.fighters[1], { x: 300, y: 300, vx: 0, vy: 0 });
      battle.elapsedMs += 300;
      const targetIndex = entry.targetId === 'a' ? 0 : 1;
      const target = battle.fighters[targetIndex];
      const event: BattleEvent = { seq: 1, timeMs: battle.elapsedMs, sourceId: 'a', targetId: entry.targetId, kind: entry.kind, amount: entry.amount, text: entry.label, x: target.x, y: target.y, ...(entry.effect ? { effect: entry.effect } : {}) };
      await page.evaluate(({ state, event }) => (window as unknown as EffectsWindow).effectsFixture.renderer.update(state, [event], true), { state: snapshot, event });
      await page.clock.runFor(40);
      const before = await page.evaluate(() => (window as unknown as EffectsWindow).effectsFixture.frame);
      expect(before.balls).toHaveLength(2);
      expect(before.labels[entry.label].x).toBeCloseTo(before.balls[targetIndex].x, 6);
      Object.assign(target, entry.targetId === 'a' ? { x: 240, y: 110 } : { x: 200, y: 220 });
      battle.elapsedMs += 200;
      await page.evaluate(state => (window as unknown as EffectsWindow).effectsFixture.renderer.update(state, []), snapshot);
      await page.clock.runFor(100);
      const after = await page.evaluate(() => (window as unknown as EffectsWindow).effectsFixture.frame);
      const ball = after.balls[targetIndex]; const label = after.labels[entry.label];
      expect(ball.x).not.toBe(before.balls[targetIndex].x);
      expect(ball.x).not.toBe(target.x); // Sample mid-interpolation, before the newest server position.
      expect(label.x).toBeCloseTo(ball.x, 6);
      expect(label.y).toBeLessThan(ball.y);
      expect(Math.abs((label.y - before.labels[entry.label].y) - (ball.y - before.balls[targetIndex].y))).toBeLessThan(8);
      if (entry.kind === 'slap') {
        expect(after.palm).not.toBeNull();
        expect(after.palm!.y).toBeCloseTo(ball.y - 4, 3);
        if (motion === 'reduce') expect(after.palm!.x).toBeCloseTo(ball.x, 3);
        else {
          expect(after.palm!.x - ball.x).toBeGreaterThanOrEqual(-0.001);
          expect(after.palm!.x - ball.x).toBeLessThanOrEqual(35.001);
          await page.locator('#effects-fixture').screenshot({ path: testInfo.outputPath('following-slap.png') });
        }
      }
      await page.clock.runFor(660);
      const expired = await page.evaluate(() => (window as unknown as EffectsWindow).effectsFixture.frame);
      expect(expired.labels[entry.label]).toBeUndefined(); expect(expired.palm).toBeNull();
    }
  }
  await page.evaluate(() => (window as unknown as EffectsWindow).effectsFixture.renderer.destroy());
});
