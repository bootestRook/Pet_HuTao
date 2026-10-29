import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { Client, type Room } from '@colyseus/sdk';
import { readConfig, originAllowed } from '../server/config.js';
import { createDefaultLoadout, ARENA_SIZE, BATTLE_LIMIT_MS } from '../shared/catalog.js';
import type { RoomSnapshot } from '../shared/types.js';

let server: ChildProcess;
let endpoint: string;
let logs = '';
const clients: Room[] = [];
async function waitFor<T>(read: () => T | undefined | false, timeout = 5000): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = read(); if (value) return value; await new Promise(r => setTimeout(r, 25)); }
  throw new Error(`Timed out waiting for state. Server: ${logs.slice(-2000)}`);
}
function observe(room: Room) {
  clients.push(room);
  const observed = { state: undefined as RoomSnapshot | undefined, errors: [] as string[], snapshots: [] as RoomSnapshot[] };
  room.onMessage('snapshot', (value: RoomSnapshot) => { observed.state = value; observed.snapshots.push(value); });
  room.onMessage('error', (value: {message: string}) => observed.errors.push(value.message));
  room.onMessage('clock', () => {});
  room.send('sync');
  return observed;
}
before(async () => {
  const probe = createServer();
  await new Promise<void>(r => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as {port: number}).port;
  await new Promise<void>((r, reject) => probe.close(e => e ? reject(e) : r()));
  endpoint = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts', '--dev'], { cwd: process.cwd(), env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), PUBLIC_URL: '', ALLOWED_ORIGINS: '' }, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
  server.stdout?.on('data', c => { logs += c.toString(); });
  server.stderr?.on('data', c => { logs += c.toString(); });
  await waitFor(() => logs.includes('Pet Arena ready'), 15000);
});
after(async () => {
  for (const client of clients) await client.leave().catch(() => {});
  server?.kill();
});

test('same server exposes health, runtime addresses and rejects cross-origin matchmaking', async () => {
  const health = await fetch(`${endpoint}/api/health`).then(r => r.json());
  assert.equal(health.app, 'pet-arena');
  assert.equal(health.ok, true);
  const config = await fetch(`${endpoint}/api/config`).then(r => r.json());
  assert.ok(Array.isArray(config.localUrls));
  const blocked = await fetch(`${endpoint}/matchmake/create/duel`, { method: 'POST', headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '外部来源' }) });
  assert.equal(blocked.status, 403);
});

test('disconnect before the room JOIN acknowledgement leaves the server healthy', { timeout: 10000 }, async () => {
  const response = await fetch(`${endpoint}/matchmake/create/duel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '握手中断测试' })
  });
  assert.equal(response.status, 200);
  const seat = await response.json() as { processId: string; roomId: string; sessionId: string };
  assert.ok(seat.roomId && seat.sessionId && seat.processId);
  // A browser may disappear after receiving the server handshake but before
  // sending Colyseus's JOIN acknowledgement. Use a raw socket, not the SDK,
  // which would automatically acknowledge the room.
  const socket = new WebSocket(`${endpoint.replace('http:', 'ws:')}/${seat.processId}/${seat.roomId}?sessionId=${encodeURIComponent(seat.sessionId)}`);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { socket.close(); reject(new Error('Handshake probe did not close')); }, 5000);
    socket.addEventListener('message', () => socket.close(), { once: true });
    socket.addEventListener('close', () => { clearTimeout(timeout); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Handshake probe connection failed')); }, { once: true });
  });
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(server.exitCode, null, `early disconnect must not terminate the server: ${logs.slice(-2000)}`);
  const health = await fetch(`${endpoint}/api/health`).then(r => r.json());
  assert.equal(health.ok, true);
  const newRoom = await new Client(endpoint).create('duel', { name: '后续正常玩家' });
  const observed = observe(newRoom);
  await waitFor(() => observed.state?.players.length === 1);
  await newRoom.leave();
});

test('LAN/public configuration and origin policy', () => {
  const config = readConfig({ PORT: '3100', PUBLIC_URL: 'https://pets.example', ALLOWED_ORIGINS: 'https://play.example' });
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.publicUrl, 'https://pets.example');
  assert.ok(originAllowed('https://pets.example', 'backend:3000', config));
  assert.ok(originAllowed('http://192.168.1.202:3100', '192.168.1.202:3100', config));
  assert.ok(!originAllowed('https://unknown.example', 'backend:3000', config));
  assert.throws(() => readConfig({ PORT: '0' }));
  assert.throws(() => readConfig({ PUBLIC_URL: 'https://pets.example/subpath' }));
});

test('server accepts both balls and empty optional systems, rejects removed content without losing ready state', { timeout: 15000 }, async () => {
  const room = await new Client(endpoint).create('duel', { name: '搭配校验' });
  const observed = observe(room);
  await waitFor(() => observed.state?.players.length === 1);
  const build = { ...createDefaultLoadout(), petId: 'renew' };
  room.send('loadout', build);
  await waitFor(() => observed.state?.players[0].loadout.petId === 'renew');
  assert.deepEqual(observed.state?.players[0].loadout, build);
  room.send('ready', { ready: true });
  await waitFor(() => observed.state?.players[0].ready);
  const invalid = [
    { ...build, items: Array.from({ length: 9 }, () => 'shield') },
    { ...build, items: ['shield', 'shield'] },
    { ...build, items: ['shield'] },
    { ...build, skills: Array.from({ length: 5 }, () => 'removed-skill') },
    { ...build, skills: ['cat-scratch', 'cat-scratch'] },
    { ...build, skills: ['fox-spark'] },
    { ...build, traitId: 'fox-critical' },
    { ...build, traitId: '' },
    { ...build, traitId: ['cat-combo', 'cat-agile'] },
    { ...build, petId: 'cat' },
    { ...build, petId: 'invented-pet' },
    { ...build, weaponId: 'invented-weapon' },
  ];
  for (const [index, payload] of invalid.entries()) {
    room.send('loadout', payload);
    await waitFor(() => observed.errors.length === index + 1);
    assert.deepEqual(observed.state?.players[0].loadout, build);
    assert.equal(observed.state?.players[0].ready, true);
  }
  room.send('loadout', createDefaultLoadout());
  await waitFor(() => observed.state?.players[0].loadout.petId === 'charge');
  assert.equal(observed.state?.players[0].ready, false);
  await room.leave();
});

test('two clients: choices, validation, ready, timed combat, refresh recovery, same result and rematch after departure', { timeout: BATTLE_LIMIT_MS + 30_000 }, async () => {
  const sdkA = new Client(endpoint);
  const a = await sdkA.create('duel', { name: '玩家甲' });
  const obsA = observe(a);
  const b = await new Client(endpoint).joinById(a.roomId, { name: '玩家乙' });
  const obsB = observe(b);
  await waitFor(() => obsA.state?.players.length === 2 && obsB.state?.players.length === 2);
  await assert.rejects(() => new Client(endpoint).joinById(a.roomId, { name: '第三人' }));
  const build = { ...createDefaultLoadout(), petId: 'renew' };
  a.send('loadout', build);
  await waitFor(() => obsA.state?.players.find(p => p.id === a.sessionId)?.loadout.petId === 'renew');
  a.send('ready', { ready: true });
  await waitFor(() => obsA.state?.players.find(p => p.id === a.sessionId)?.ready);
  a.send('loadout', build);
  await waitFor(() => obsA.state && !obsA.state.players.find(p => p.id === a.sessionId)?.ready);
  a.send('loadout', { ...build, items: ['fang','fang'] });
  await waitFor(() => obsA.errors.length === 1);
  a.send('loadout', { ...build, attack: 999999 });
  await waitFor(() => obsA.errors.length === 2);
  a.send('ready', { ready: true });
  b.send('ready', { ready: true });
  const countdown = await waitFor(() => obsA.state?.phase === 'countdown' && obsA.state);
  assert.equal(countdown.battle, null, 'battle is not computed before the countdown');
  a.send('loadout', createDefaultLoadout());
  await waitFor(() => obsA.errors.length === 3);
  const start = await waitFor(() => obsA.state?.phase === 'battle' && obsA.state, 6000);
  assert.equal(start.battle?.finished, false);
  const matchId = start.matchId;
  await waitFor(() => (obsB.state?.battle?.elapsedMs ?? 0) > 1400);
  const moving = obsB.state!.battle!;
  assert.ok(moving.fighters.some(fighter => {
    const initial = start.battle!.fighters.find(entry => entry.id === fighter.id)!;
    return fighter.x !== initial.x || fighter.y !== initial.y;
  }), 'clients receive actual changing ball positions');
  for (const fighter of moving.fighters) {
    assert.ok(fighter.x >= fighter.radius && fighter.x <= ARENA_SIZE - fighter.radius);
    assert.ok(fighter.y >= fighter.radius && fighter.y <= ARENA_SIZE - fighter.radius);
    assert.ok(Number.isFinite(fighter.vx) && Number.isFinite(fighter.vy));
  }
  // Simulate a page reload: dispose the old transport and reconnect with the stored token.
  const token = b.reconnectionToken;
  b.reconnection.enabled = false;
  b.connection.close();
  await waitFor(() => obsA.state?.players.some(p => p.id === b.sessionId && !p.connected));
  await new Promise(r => setTimeout(r, 300));
  const restored = await new Client(endpoint).reconnect(token);
  const obsRestored = observe(restored);
  await waitFor(() => obsRestored.state?.matchId === matchId && (obsRestored.state.battle?.elapsedMs ?? 0) > 1400);
  assert.equal(restored.sessionId, b.sessionId);
  const resultA = await waitFor(() => obsA.state?.phase === 'finished' && obsA.state, BATTLE_LIMIT_MS + 5000);
  const resultB = await waitFor(() => obsRestored.state?.phase === 'finished' && obsRestored.state);
  assert.equal(resultA.matchId, resultB.matchId);
  assert.deepEqual(resultA.battle, resultB.battle);
  assert.deepEqual(resultA.events, resultB.events);
  assert.ok((resultA.battle?.elapsedMs ?? 0) > 2000);
  const hp = resultA.battle?.fighters.map(f => f.hp);
  a.send('ready', { ready: true });
  await new Promise(r => setTimeout(r, 150));
  assert.deepEqual(obsA.state?.battle?.fighters.map(f => f.hp), hp);
  a.send('rematch');
  await waitFor(() => obsA.state?.players.find(p => p.id === a.sessionId)?.rematch);
  assert.equal(obsA.state?.phase, 'finished');
  // A has already requested another round; if B leaves instead of agreeing,
  // the survivor must return to the lobby without an impossible second click.
  await restored.leave();
  await waitFor(() => obsA.state?.phase === 'waiting' && obsA.state.players.length === 1);
  assert.equal(obsA.state?.battle, null);
  assert.ok(obsA.state?.players.every(p => !p.ready && !p.rematch));
  const replacement = await new Client(endpoint).joinById(a.roomId, { name: '替补玩家' });
  const obsReplacement = observe(replacement);
  await waitFor(() => obsA.state?.players.length === 2 && obsReplacement.state?.phase === 'waiting');
  assert.ok(!obsA.state?.players.some(p => p.id === b.sessionId));
  await a.leave(); await replacement.leave();
});

test('disconnect during countdown cancels start; freed waiting seat admits another player', { timeout: 10000 }, async () => {
  const a = await new Client(endpoint).create('duel', { name: '房主' });
  const oa = observe(a);
  const b = await new Client(endpoint).joinById(a.roomId, { name: '访客' });
  observe(b);
  a.send('ready', { ready: true }); b.send('ready', { ready: true });
  await waitFor(() => oa.state?.phase === 'countdown');
  await b.leave();
  await waitFor(() => oa.state?.phase === 'waiting' && oa.state.players.length === 1);
  assert.equal(oa.state?.players[0].ready, false);
  const c = await new Client(endpoint).joinById(a.roomId, { name: '新访客' });
  observe(c);
  await waitFor(() => oa.state?.players.length === 2);
  await a.leave(); await c.leave();
});

test('spectator creator retains its seat across join order and reconnect; only two invited players control combat', { timeout: 15000 }, async () => {
  const hostKey = randomBytes(32).toString('hex');
  const response = await fetch(`${endpoint}/matchmake/create/duel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '观战主机', mode: 'spectator', hostKey })
  });
  assert.equal(response.status, 200);
  const reservation = await response.json();
  // Invitees may claim both player seats and ready before the creator's socket
  // consumes its reserved seat. Join order must never decide who is the host.
  const a = await new Client(endpoint).joinById(reservation.roomId, { name: '先到玩家', mode: 'spectator', role: 'host' });
  const oa = observe(a);
  const b = await new Client(endpoint).joinById(reservation.roomId, { name: '后到玩家' });
  observe(b);
  await waitFor(() => oa.state?.players.length === 2);
  assert.equal(oa.state?.mode, 'spectator');
  assert.equal(oa.state?.host, null);
  a.send('ready', { ready: true }); b.send('ready', { ready: true });
  const countdown = await waitFor(() => oa.state?.phase === 'countdown' && oa.state);
  const host = await new Client(endpoint).consumeSeatReservation(reservation);
  const oh = observe(host);
  await waitFor(() => oh.state?.host?.id === host.sessionId);
  assert.equal(oh.state?.host?.name, '观战主机');
  assert.deepEqual(oh.state?.players.map(player => player.id), [a.sessionId, b.sessionId]);
  assert.equal(oh.state?.matchId, countdown.matchId);
  assert.ok(!JSON.stringify(oh.state).includes(hostKey), 'creator key must never be broadcast');
  await assert.rejects(() => new Client(endpoint).joinById(host.roomId, { name: '额外观众', mode: 'spectator', role: 'host' }));
  host.send('loadout', createDefaultLoadout());
  host.send('ready', { ready: false });
  host.send('rematch');
  await waitFor(() => oh.errors.length === 3);
  assert.ok(oh.state?.players.every(player => player.ready));

  const token = host.reconnectionToken;
  host.reconnection.enabled = false;
  host.connection.close();
  await waitFor(() => oa.state?.host?.connected === false);
  assert.equal(oa.state?.matchId, countdown.matchId);
  assert.notEqual(oa.state?.phase, 'waiting', 'host disconnection must not cancel countdown');
  const restored = await new Client(endpoint).reconnect(token);
  const restoredState = observe(restored);
  await waitFor(() => restoredState.state?.host?.connected);
  assert.equal(restored.sessionId, host.sessionId);
  assert.equal(restoredState.state?.host?.id, host.sessionId);
  await restored.leave();
  await waitFor(() => oa.state?.host === null);
  assert.equal(oa.state?.matchId, countdown.matchId);
  assert.notEqual(oa.state?.phase, 'waiting', 'host exit must not cancel countdown');

  await b.leave();
  await waitFor(() => oa.state?.phase === 'waiting' && oa.state.players.length === 1);
  const replacement = await new Client(endpoint).joinById(a.roomId, { name: '替补玩家' });
  observe(replacement);
  await waitFor(() => oa.state?.players.length === 2);
  a.send('ready', { ready: true });
  await waitFor(() => oa.state?.players[0].ready);
  // The now-free host connection slot cannot become a third combatant.
  await assert.rejects(() => new Client(endpoint).joinById(a.roomId, { name: '第三位玩家', hostKey }));
  assert.equal(oa.state?.players.length, 2);
  assert.equal(oa.state?.players[0].ready, true);
  await a.leave(); await replacement.leave();
});

test('spectator receives the same battle result and its room survives both players leaving', { timeout: BATTLE_LIMIT_MS + 30_000 }, async () => {
  await assert.rejects(() => new Client(endpoint).create('duel', { name: '无效模式', mode: 'spectator' }));
  const host = await new Client(endpoint).create('duel', { name: '主持人', mode: 'spectator', hostKey: randomBytes(32).toString('hex') });
  const oh = observe(host);
  await waitFor(() => oh.state?.host?.id === host.sessionId);
  assert.equal(oh.state?.players.length, 0);
  const a = await new Client(endpoint).joinById(host.roomId, { name: '红方' });
  const oa = observe(a);
  const b = await new Client(endpoint).joinById(host.roomId, { name: '蓝方' });
  const ob = observe(b);
  const build = { ...createDefaultLoadout(), petId: 'renew' };
  a.send('loadout', build); b.send('loadout', build);
  await waitFor(() => oh.state?.players.length === 2 && oh.state.players.every(player => player.loadout.petId === 'renew'));
  a.send('ready', { ready: true }); b.send('ready', { ready: true });
  const underway = await waitFor(() => oh.state?.phase === 'battle' && oh.state, 6000);
  assert.equal(underway.battle?.fighters.length, 2);
  assert.ok(!underway.battle?.fighters.some(fighter => fighter.id === host.sessionId));
  const result = await waitFor(() => oh.state?.phase === 'finished' && oh.state, BATTLE_LIMIT_MS + 5000);
  await waitFor(() => oa.state?.phase === 'finished' && ob.state?.phase === 'finished');
  assert.deepEqual(result.battle, oa.state?.battle);
  assert.deepEqual(result.battle, ob.state?.battle);
  assert.deepEqual(result.events, oa.state?.events);
  host.send('rematch');
  await waitFor(() => oh.errors.length === 1);
  assert.ok(oh.state?.players.every(player => !player.rematch));
  await a.leave(); await b.leave();
  await waitFor(() => oh.state?.phase === 'waiting' && oh.state.players.length === 0);
  assert.equal(oh.state?.battle, null);
  assert.equal(oh.state?.host?.id, host.sessionId);
  const nextPlayer = await new Client(endpoint).joinById(host.roomId, { name: '下一局玩家' });
  observe(nextPlayer);
  await waitFor(() => oh.state?.players.length === 1);
  await nextPlayer.leave();
  await waitFor(() => oh.state?.players.length === 0);
  await host.leave();
  await assert.rejects(() => new Client(endpoint).joinById(host.roomId, { name: '房间已关闭' }));
});

test('spectator still sees the final result when both players leave mid-battle, then accepts new invitees', { timeout: BATTLE_LIMIT_MS + 30_000 }, async () => {
  const host = await new Client(endpoint).create('duel', { name: '留守观众', mode: 'spectator', hostKey: randomBytes(32).toString('hex') });
  const observed = observe(host);
  const a = await new Client(endpoint).joinById(host.roomId, { name: '离场红方' });
  observe(a);
  const b = await new Client(endpoint).joinById(host.roomId, { name: '离场蓝方' });
  observe(b);
  const build = { ...createDefaultLoadout(), petId: 'renew' };
  a.send('loadout', build); b.send('loadout', build);
  await waitFor(() => observed.state?.players.length === 2 && observed.state.players.every(player => player.loadout.petId === 'renew'));
  a.send('ready', { ready: true }); b.send('ready', { ready: true });
  const battle = await waitFor(() => observed.state?.phase === 'battle' && observed.state, 6000);
  await a.leave(); await b.leave();
  const result = await waitFor(() => observed.state?.phase === 'finished' && observed.state, BATTLE_LIMIT_MS + 5000);
  assert.equal(result.matchId, battle.matchId);
  assert.equal(result.battle?.finished, true);
  assert.ok(result.battle?.draw || result.battle?.winnerId);
  assert.equal(result.events.at(-1)?.kind, 'end');
  assert.ok(result.players.every(player => !player.connected));
  const next = await new Client(endpoint).joinById(host.roomId, { name: '下一局红方' });
  observe(next);
  await waitFor(() => observed.state?.phase === 'waiting' && observed.state.players.length === 1);
  assert.equal(observed.state?.players[0].id, next.sessionId);
  assert.equal(observed.state?.battle, null);
  assert.equal(observed.state?.host?.id, host.sessionId);
  await next.leave(); await host.leave();
});
