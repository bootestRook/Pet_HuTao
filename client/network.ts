import { Client, type Room } from '@colyseus/sdk';
import type { Loadout, RoomSnapshot, SeatRole, ServerInfo } from '../shared/types.js';
import { readStorage, writeStorage } from './storage.js';

const SESSION_KEY = 'pet-arena:seat';
export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed';
export class ArenaConnection {
  private client = new Client(location.origin);
  private room: Room | null = null;
  private generation = 0;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private clockOffset = 0;
  private hasClock = false;
  onSnapshot: (snapshot: RoomSnapshot, resumed: boolean) => void = () => {};
  onStatus: (status: ConnectionState) => void = () => {};
  onError: (message: string) => void = () => {};
  onExit: () => void = () => {};
  get playerId() { return this.room?.sessionId ?? ''; }
  get serverNow() { return Date.now() + this.clockOffset; }
  async config(): Promise<ServerInfo | null> {
    try { const response = await fetch('/api/config'); return response.ok ? await response.json() as ServerInfo : null; } catch { return null; }
  }
  async create(name: string) {
    return this.connect(() => this.client.create('duel', { name }));
  }
  async join(roomId: string, name: string) { return this.connect(() => this.client.joinById(roomId, { name })); }
  async restore(): Promise<boolean> {
    let saved: { token: string; roomId: string };
    try { saved = JSON.parse(readStorage('session', SESSION_KEY) ?? 'null'); } catch { return false; }
    if (!saved?.token) return false;
    const requestedRoom = new URL(location.href).searchParams.get('room');
    if (requestedRoom && requestedRoom !== saved.roomId) return false;
    return this.connect(() => this.client.reconnect(saved.token), true);
  }
  private async connect(action: () => Promise<Room>, resumed = false): Promise<boolean> {
    const generation = ++this.generation;
    this.onStatus('connecting');
    try {
      const room = await action();
      if (generation !== this.generation) { void room.leave(); return false; }
      this.room = room;
      // Also recover a network drop immediately after joining; the SDK's
      // five-second default minimum uptime would otherwise discard this seat.
      room.reconnection.minUptime = 0;
      let restoring = resumed;
      this.saveSeat();
      room.onMessage('snapshot', (snapshot: RoomSnapshot) => {
        if (generation !== this.generation) return;
        if (!this.hasClock) this.clockOffset = snapshot.serverTime - Date.now();
        this.onSnapshot(snapshot, restoring);
        restoring = false;
      });
      room.onMessage('error', (error: { message?: string }) => this.onError(error.message || '操作未成功，请稍后再试。'));
      room.onMessage('clock', (clock: { clientTime: number; serverTime: number }) => {
        this.clockOffset = clock.serverTime - (clock.clientTime + Date.now()) / 2;
        this.hasClock = true;
      });
      room.onDrop(() => { if (generation === this.generation) { restoring = true; this.onStatus('reconnecting'); } });
      room.onReconnect(() => {
        // SDK 0.18 emits onReconnect before it updates the rotated token.
        // Persist after the JOIN handler finishes, so a later reload uses the
        // new reservation instead of the now-invalid previous token.
        queueMicrotask(() => {
          if (generation !== this.generation) return;
          this.saveSeat(); this.onStatus('connected'); room.send('sync'); this.ping();
        });
      });
      room.onLeave(() => {
        if (generation !== this.generation) return;
        this.clear(); this.onStatus('closed'); this.onError('已离开房间，或连接恢复时间已结束。可以重新创建或加入房间。'); this.onExit();
      });
      room.onError((_code: number, message?: string) => this.onError(message || '连接出现问题，正在尝试恢复。'));
      this.onStatus('connected');
      room.send('sync');
      this.ping();
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.ping(), 5000);
      return true;
    } catch (error) {
      if (generation !== this.generation) return false;
      this.clear(); this.onStatus('idle');
      const message = error instanceof Error ? error.message : '';
      this.onError(resumed ? '上次的房间已无法恢复，请重新加入或创建房间。' : this.friendlyError(message));
      return false;
    }
  }
  private friendlyError(message: string) {
    if (/full|maxClients|locked/i.test(message)) return '房间已满（2 个对战位、8 个观众位），请等待空位。';
    if (/not found|not available|invalid room|room.*exist/i.test(message)) return '没有找到这个房间，请检查房间码。';
    if (/[\u4e00-\u9fff]/.test(message)) return message;
    return '连接失败，请检查服务器是否运行、网络是否可达，或房间码是否正确。';
  }
  private saveSeat() {
    if (this.room) writeStorage('session', SESSION_KEY, JSON.stringify({ token: this.room.reconnectionToken, roomId: this.room.roomId }));
  }
  private ping() { this.room?.send('ping', { clientTime: Date.now() }); }
  loadout(loadout: Loadout) { this.room?.send('loadout', loadout); }
  ready(ready: boolean) { this.room?.send('ready', { ready }); }
  rematch() { this.room?.send('rematch'); }
  switchSeat(role: SeatRole) { this.room?.send('switch-seat', { role }); }
  async leave() {
    ++this.generation;
    const room = this.room;
    this.clear(); this.onStatus('idle');
    if (room) await room.leave();
  }
  private clear() { clearInterval(this.pingTimer); this.room = null; writeStorage('session', SESSION_KEY, null); this.hasClock = false; }
}
