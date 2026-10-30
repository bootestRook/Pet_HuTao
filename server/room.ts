import { randomBytes, randomUUID } from 'node:crypto';
import { Room, ServerError, type Client } from '@colyseus/core';
import { z } from 'zod';
import { createDefaultLoadout, selectionLimit, validateLoadout } from '../shared/catalog.js';
import { PLAYER_CAPACITY, SPECTATOR_CAPACITY, type BattleEvent, type Loadout, type PlayerInfo, type RoomSnapshot } from '../shared/types.js';
import { BattleSimulator } from './battle.js';

const nameSchema = z.string().trim().min(1).max(16).refine(s => !/[\u0000-\u001f\u007f]/.test(s));
const loadoutSchema = z.object({
  petId: z.string().max(64),
  items: z.array(z.string().max(64)).max(selectionLimit('items')),
  skills: z.array(z.string().max(64)).max(selectionLimit('skills')),
  traitId: z.string().min(1).max(64).nullable(),
}).strict().refine(value => validateLoadout(value as Loadout));
const activeRooms = new Set<string>();
type Admission = { name: string };

/** A single room owns the clock and combat. Clients only request pre-match choices.
 * Full snapshots include a bounded event tail so reconnect never depends on missed packets.
 */
export class DuelRoom extends Room {
  maxClients = PLAYER_CAPACITY + SPECTATOR_CAPACITY;
  autoDispose = false;
  maxMessagesPerSecond = 25;
  patchRate = null;
  private players = new Map<string, PlayerInfo>();
  private spectators = new Map<string, PlayerInfo>();
  private departed = new Set<string>();
  private phase: RoomSnapshot['phase'] = 'waiting';
  private startAt = 0;
  private matchId = '';
  private simulator: BattleSimulator | null = null;
  private events: BattleEvent[] = [];
  private lastActivity = Date.now();
  private battleOrigin = 0;
  private lastBattleTick = 0;
  private closing = false;

  async onCreate(options: unknown) {
    this.parseName(options);
    if (activeRooms.size >= 100) throw new ServerError(503, '房间已满，请稍后再试。');
    activeRooms.add(this.roomId);
    await this.setPrivate(true);
    this.onMessage('sync', client => client.send('snapshot', this.snapshot()));
    this.onMessage('ping', (client, payload: unknown) => {
      const parsed = z.object({ clientTime: z.number().finite() }).safeParse(payload);
      if (parsed.success) client.send('clock', { clientTime: parsed.data.clientTime, serverTime: Date.now() });
    });
    this.onMessage('loadout', (client, payload: unknown) => {
      const player = this.players.get(client.sessionId);
      if (!player) return this.error(client, '观众不能修改玩家搭配，请先加入对战位。');
      if (this.phase !== 'waiting') return this.error(client, '比赛已经锁定，结束后再调整搭配。');
      const parsed = loadoutSchema.safeParse(payload);
      if (!parsed.success) return this.error(client, '搭配无效：请选择目录中的小球与道具，道具最多 3 件且不能重复；技能和特性当前应留空。');
      player.loadout = parsed.data as Loadout;
      player.ready = false;
      this.touch();
      this.publish();
    });
    this.onMessage('ready', (client, payload: unknown) => {
      const player = this.players.get(client.sessionId);
      if (!player) return this.error(client, '观众不能准备，请先加入对战位。');
      if (this.phase !== 'waiting') return this.error(client, '比赛已开始，无法改变准备状态。');
      const parsed = z.object({ ready: z.boolean() }).strict().safeParse(payload);
      if (!parsed.success) return this.error(client, '无效的准备请求。');
      player.ready = parsed.data.ready;
      this.touch();
      if (this.players.size === PLAYER_CAPACITY && [...this.players.values()].every(p => p.ready && p.connected)) {
        this.phase = 'countdown';
        this.startAt = Date.now() + 3000;
        this.battleOrigin = performance.now() + 3000;
        this.matchId = randomUUID();
      }
      this.publish();
    });
    this.onMessage('rematch', client => {
      const player = this.players.get(client.sessionId);
      if (!player) return this.error(client, '再战由两名对战玩家决定。');
      if (this.phase !== 'finished') return this.error(client, '本局还没有结束。');
      player.rematch = true;
      this.touch();
      this.tryRematch();
      this.publish();
    });
    this.onMessage('switch-seat', (client, payload: unknown) => {
      const parsed = z.object({ role: z.enum(['player', 'spectator']) }).strict().safeParse(payload);
      if (!parsed.success) return this.error(client, '无效的席位切换请求。');
      if (this.phase === 'countdown' || this.phase === 'battle') return this.error(client, '倒计时或对战中不能切换席位，请等待本局结束。');
      const from = parsed.data.role === 'player' ? this.spectators : this.players;
      const to = parsed.data.role === 'player' ? this.players : this.spectators;
      const member = from.get(client.sessionId);
      if (!member) return this.error(client, '你已在该席位。');
      const occupied = parsed.data.role === 'player' ? this.remainingPlayers().length : this.spectators.size;
      const capacity = parsed.data.role === 'player' ? PLAYER_CAPACITY : SPECTATOR_CAPACITY;
      if (occupied >= capacity) return this.error(client, parsed.data.role === 'player' ? '对战位已满，请等待空位。' : '观众席已满，最多容纳 8 人。');
      if (this.phase === 'finished') this.resetWaiting();
      from.delete(client.sessionId);
      to.set(client.sessionId, member);
      this.clearReady();
      this.touch();
      this.publish();
    });
    this.onMessage('*', client => this.error(client, '不支持的操作。'));
    this.setSimulationInterval(() => this.tick(), 100);
  }

  onAuth(_client: Client, options: unknown): Admission {
    return { name: this.parseName(options) };
  }

  onJoin(client: Client) {
    const admission = client.auth as Admission;
    // Assign on join, rather than auth: reservations can be consumed concurrently.
    const canPlay = (this.phase === 'waiting' || this.phase === 'finished') && this.remainingPlayers().length < PLAYER_CAPACITY;
    if (!canPlay && this.spectators.size >= SPECTATOR_CAPACITY) throw new ServerError(403, '观众席已满，最多容纳 8 人。');
    if (canPlay && this.phase === 'finished') this.resetWaiting();
    const seats = canPlay ? this.players : this.spectators;
    seats.set(client.sessionId, {
      id: client.sessionId, name: admission.name, connected: true, ready: false,
      rematch: false, loadout: createDefaultLoadout()
    });
    this.touch();
    this.publish();
  }

  onDrop(client: Client) {
    const player = this.players.get(client.sessionId);
    if (player) { player.connected = false; player.ready = false; player.rematch = false; }
    const spectator = this.spectators.get(client.sessionId);
    if (spectator) spectator.connected = false;
    if (player && this.phase === 'countdown') this.cancelCountdown();
    // A socket may drop before its JOIN acknowledgement. Colyseus rejects that
    // reservation immediately; consume the rejection so it cannot crash Node.
    // The framework owns seat cleanup after a rejected/expired reservation.
    this.allowReconnection(client, 60).catch(() => {});
    this.publish();
  }

  onReconnect(client: Client) {
    const player = this.players.get(client.sessionId);
    if (player) player.connected = true;
    const spectator = this.spectators.get(client.sessionId);
    if (spectator) spectator.connected = true;
    this.touch();
    this.publish();
  }

  onLeave(client: Client) {
    if (this.spectators.delete(client.sessionId)) {
      this.publish();
      this.disposeIfEmpty();
      return;
    }
    const player = this.players.get(client.sessionId);
    if (!player) return;
    if (player) { player.connected = false; player.ready = false; player.rematch = false; }
    if (this.phase === 'countdown') this.cancelCountdown();
    if (this.phase === 'waiting') {
      this.players.delete(client.sessionId);
      for (const p of this.players.values()) p.ready = false;
    } else {
      // Retain fighters until the result has been seen; a rematch removes departed seats.
      this.departed.add(client.sessionId);
      this.tryRematch();
    }
    this.publish();
    this.disposeIfEmpty();
  }

  onDispose() { activeRooms.delete(this.roomId); }

  private tick() {
    if (this.closing) return;
    const now = performance.now();
    if (this.phase === 'countdown' && now >= this.battleOrigin) {
      this.simulator = new BattleSimulator([...this.players.values()], randomBytes(4).readUInt32LE());
      this.phase = 'battle';
      this.lastBattleTick = this.battleOrigin;
    }
    if (this.phase === 'battle' && this.simulator) {
      this.events.push(...this.simulator.advance(now - this.lastBattleTick));
      this.events = this.events.slice(-80);
      this.lastBattleTick = now;
      if (this.simulator.snapshot().finished) {
        this.phase = 'finished';
        this.touch();
        // Keep the result visible to spectators until someone joins a vacant
        // combat seat or switches seats to begin the next lobby.
      }
      this.publish();
      this.disposeIfEmpty();
    } else if (this.phase === 'countdown') {
      this.publish();
    }
    if (Date.now() - this.lastActivity > 30 * 60_000) this.close();
    // A creation whose seat is never claimed must not leak an empty room.
    if (!this.players.size && !this.spectators.size && Date.now() - this.lastActivity > 30_000) this.close();
  }

  private snapshot(): RoomSnapshot {
    return {
      roomId: this.roomId, phase: this.phase, players: [...this.players.values()],
      spectators: [...this.spectators.values()].map(({ id, name, connected }) => ({ id, name, connected })),
      availablePlayerSeats: PLAYER_CAPACITY - this.remainingPlayers().length,
      serverTime: Date.now(), startAt: this.startAt, matchId: this.matchId,
      battle: this.simulator?.snapshot() ?? null, events: this.events
    };
  }
  private publish() { this.broadcast('snapshot', this.snapshot()); }
  private touch() { this.lastActivity = Date.now(); }
  private error(client: Client, message: string) { client.send('error', { message }); }
  private parseName(options: unknown) {
    const result = z.object({ name: nameSchema }).safeParse(options);
    if (!result.success) throw new ServerError(400, '昵称需要 1–16 个字符，不能包含控制字符。');
    return result.data.name;
  }
  private cancelCountdown() {
    this.phase = 'waiting'; this.startAt = 0; this.matchId = '';
    this.clearReady();
  }
  private resetWaiting() {
    for (const id of this.departed) this.players.delete(id);
    this.departed.clear();
    this.phase = 'waiting'; this.simulator = null; this.events = []; this.startAt = 0; this.matchId = '';
    this.clearReady();
  }
  private clearReady() {
    for (const member of [...this.players.values(), ...this.spectators.values()]) { member.ready = false; member.rematch = false; }
  }
  private remainingPlayers() { return [...this.players.values()].filter(p => !this.departed.has(p.id)); }
  private tryRematch() {
    if (this.phase !== 'finished') return;
    const remaining = this.remainingPlayers();
    if ((remaining.length && remaining.every(p => p.connected && p.rematch)) || (!remaining.length && this.spectators.size)) this.resetWaiting();
  }
  private disposeIfEmpty() {
    if (this.phase === 'battle' || this.phase === 'countdown') return;
    if (this.spectators.size) return;
    if (![...this.players.values()].some(p => !this.departed.has(p.id))) this.close();
  }
  private close() {
    if (this.closing) return;
    this.closing = true;
    void this.disconnect();
  }
}
