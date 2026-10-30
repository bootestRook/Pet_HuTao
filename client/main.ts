import './style.css';
import { ITEMS, LOADOUT_CATEGORIES, PETS, cloneLoadout, createDefaultLoadout, getSelection, selectionLimit, validateLoadout } from '../shared/catalog.js';
import { PLAYER_CAPACITY, SPECTATOR_CAPACITY, type BattleEvent, type Loadout, type PlayerInfo, type RoomSnapshot, type ServerInfo } from '../shared/types.js';
import { ArenaRenderer } from './arena.js';
import { ArenaConnection, type ConnectionState } from './network.js';
import { readStorage, writeStorage } from './storage.js';
import { LoadoutView } from './loadout-view.js';
import { HUTAO_NOSTALGIA_HEAL, HUTAO_ROLL_DURATION_MS, HUTAO_ROLL_INTERVAL_MS } from '../shared/hutao.js';
import { JACKPOT_LABELS, WORLD_EFFECTS } from '../shared/world-effects.js';
import { LIANG_REDUCTION, LIANG_RETURN_BONUS } from '../shared/liangchushuo.js';

function $<T extends HTMLElement = HTMLElement>(id: string): T { return document.getElementById(id) as T; }
function text(id: string, value: string) { const element = $(id); if (element.textContent !== value) element.textContent = value; }
const connection = new ArenaConnection();
let renderer: ArenaRenderer | null = null;
let snapshot: RoomSnapshot | null = null;
let draft: Loadout = createDefaultLoadout();
let matchId = '';
let lastEvent = 0;
let serverInfo: ServerInfo | null = null;
let status: ConnectionState = 'idle';
let pending = false;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
const nickname = $<HTMLInputElement>('nickname');
const roomCode = $<HTMLInputElement>('room-code');
nickname.value = readStorage('local', 'pet-arena:name') || '';
roomCode.value = new URL(location.href).searchParams.get('room') || '';

function toast(message: string) {
  text('toast', message); $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5200);
}
function busy(value: boolean) {
  pending = value;
  $<HTMLButtonElement>('create').disabled = value;
  $<HTMLButtonElement>('join').disabled = value;
  text('entry-status', value ? '正在连接斗场…' : '');
}
function player() { return snapshot?.players.find(p => p.id === connection.playerId); }
function isSpectator() { return snapshot?.spectators.some(p => p.id === connection.playerId) ?? false; }
function renderMembers() {
  if (!snapshot) return;
  const spectator = isSpectator();
  text('player-count', `${PLAYER_CAPACITY - snapshot.availablePlayerSeats} / ${PLAYER_CAPACITY}`);
  text('spectator-count', `${snapshot.spectators.length} / ${SPECTATOR_CAPACITY}`);
  text('my-role', spectator ? '你在观众席' : '你在对战位');
  const locked = snapshot.phase === 'countdown' || snapshot.phase === 'battle';
  const full = spectator ? snapshot.availablePlayerSeats === 0 : snapshot.spectators.length >= SPECTATOR_CAPACITY;
  const button = $<HTMLButtonElement>('switch-seat');
  button.disabled = status !== 'connected' || locked || full;
  text('switch-seat', spectator ? '加入对战位' : '加入观众席');
  text('seat-hint', status !== 'connected' ? '连接恢复后可切换席位。' : locked ? '倒计时和对战中席位已锁定，本局结束后可切换。' : full ? spectator ? '对战位已满，请等待玩家离席。短暂离线会保留原席位。' : '观众席已满，最多容纳 8 人。' : '准备阶段和结算后可切换席位，切换后双方需要重新准备。');
  const list = $('spectator-list');
  const key = JSON.stringify(snapshot.spectators);
  if (list.dataset.key === key) return;
  list.dataset.key = key;
  list.replaceChildren();
  for (let i = 0; i < SPECTATOR_CAPACITY; i++) {
    const member = snapshot.spectators[i];
    const item = document.createElement('li');
    const name = document.createElement('strong');
    const state = document.createElement('span');
    name.textContent = member ? `${member.name}${member.id === connection.playerId ? ' · 我' : ''}` : `观众位 ${i + 1}`;
    state.textContent = member ? member.connected ? '正在观战' : '暂时离线' : '空位';
    if (member) item.title = member.name;
    item.classList.toggle('is-self', member?.id === connection.playerId);
    item.classList.toggle('is-empty', !member);
    item.append(name, state); list.append(item);
  }
}
function loadoutCounts(loadout: Loadout) {
  return LOADOUT_CATEGORIES.filter(category => category.id !== 'pets').map(category => `${category.label} ${getSelection(loadout, category.id).length}`).join(' · ');
}
const loadoutView = new LoadoutView(next => {
  if (!snapshot || !player() || snapshot.phase !== 'waiting' || status !== 'connected') return;
  if (JSON.stringify(next) === JSON.stringify(draft)) return;
  if (player()?.ready) connection.ready(false);
  draft = cloneLoadout(next);
  connection.loadout(cloneLoadout(draft));
  renderChoices();
});
function renderChoices() {
  const me = player();
  const spectator = isSpectator();
  $('player-preparation').hidden = spectator;
  $('player-ready').hidden = spectator;
  $('spectator-waiting').hidden = !spectator;
  if (spectator && snapshot) {
    const readyCount = snapshot.players.filter(p => p.ready && p.connected).length;
    const waiting = snapshot.players.length < 2;
    text('spectator-status', status === 'reconnecting' ? '正在恢复观战连接…' : snapshot.phase === 'countdown' ? '双方已准备，即将开战' : waiting ? `等待 ${2 - snapshot.players.length} 名玩家加入` : snapshot.players.some(p => !p.connected) ? '等待玩家重新连接' : `等待双方准备 · ${readyCount} / 2`);
    text('spectator-hint', waiting ? '邀请好友入座，或点击「加入对战位」亲自出战。双方准备后，这里会自动进入战斗画面。' : '两位玩家各自调整搭配并准备，你将同步观看这场对决。');
  }
  const locked = !snapshot || !me || snapshot.phase !== 'waiting' || status !== 'connected';
  loadoutView.update(draft, locked);
  text('loadout-lock', locked ? '已锁定' : '可调整');
  const ready = $<HTMLButtonElement>('ready');
  ready.disabled = locked || !validateLoadout(draft);
  ready.classList.toggle('is-ready', !!me?.ready);
  ready.textContent = snapshot?.phase === 'countdown' ? '即将开战…' : me?.ready ? '已准备 · 点击取消' : '准备好了';
  const hint = status === 'reconnecting' ? '连接中断，正在恢复…' : locked ? '搭配已锁定，即将开始对战。' : me?.ready ? '等待好友准备。浏览内容不会取消准备，修改搭配会。' : '选好小球，可携带最多 3 件搞怪道具。技能和特性当前暂无内容。';
  text('ready-status', snapshot?.phase === 'countdown' ? '双方已准备，即将开战' : me?.ready ? '你的搭配已准备就绪' : '搭配完成，就准备出战');
  text('ready-hint', hint);
}
function renderSeat(index: number, info: PlayerInfo | undefined) {
  const seat = $(`seat-${index}`);
  const set = (selector: string, value: string) => { const element = seat.querySelector<HTMLElement>(selector)!; if (element.textContent !== value) element.textContent = value; };
  const pet = PETS.find(pet => pet.id === info?.loadout.petId);
  set('.seat-name', info ? `${info.name}${info.id === connection.playerId ? ' · 我' : ''}` : '等待好友');
  set('.seat-summary', info ? `${pet?.name} · ${loadoutCounts(info.loadout)}` : '复制邀请链接，让好友加入');
  set('.seat-status', !info ? '空位' : !info.connected ? '暂时离线' : snapshot?.phase === 'battle' ? '对战中' : snapshot?.phase === 'finished' ? '已结束' : info.ready ? '已准备' : '搭配中');
  seat.dataset.ready = String(!!info?.ready); seat.dataset.connected = String(!!info?.connected);
}
function shareUrl(roomId: string) {
  const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const base = serverInfo?.publicUrl || (localHost && serverInfo?.localUrls[0] ? serverInfo.localUrls[0] : location.origin);
  const url = new URL(base); url.searchParams.set('room', roomId); return url.toString();
}
function renderPlayer(index: number, info: PlayerInfo | undefined) {
  const card = $(`player-${index}`);
  const set = (selector: string, value: string) => { const element = card.querySelector<HTMLElement>(selector)!; if (element.textContent !== value) element.textContent = value; };
  const fighter = snapshot?.battle?.fighters.find(f => f.id === info?.id);
  const pet = PETS.find(p => p.id === info?.loadout.petId);
  card.classList.toggle('is-self', info?.id === connection.playerId);
  set('.fighter-name', info ? `P${index + 1} · ${info.name}${info.id === connection.playerId ? ' · 我' : ''}` : '等待好友');
  set('.fighter-status', !info ? '空位' : !info.connected ? '暂时离线' : snapshot?.phase === 'battle' ? '对战中' : snapshot?.phase === 'finished' ? '已结束' : info.ready ? '已准备' : '搭配中');
  set('.fighter-pet', pet ? pet.name : '等待好友加入');
  card.style.setProperty('--fighter-color', pet?.color ?? '#8ca6a4');
  const hp = fighter?.hp ?? pet?.hp ?? 0;
  const maxHp = fighter?.maxHp ?? pet?.hp ?? 1;
  const percent = hp / maxHp * 100;
  const fill = card.querySelector<HTMLElement>('.health-fill')!; fill.style.transform = `scaleX(${percent / 100})`; fill.classList.toggle('low', percent < 35);
  const track = card.querySelector<HTMLElement>('.health-track')!; track.setAttribute('aria-valuenow', String(hp)); track.setAttribute('aria-valuemax', String(maxHp));
  set('.health-label', info ? `${hp} / ${maxHp} HP` : '—');
  set('.effect-label', fighter?.petId === 'hutao' ? `忆往昔 ${fighter.nostalgiaUsed ? '已用' : `待用 +${HUTAO_NOSTALGIA_HEAL}`}` : fighter ? `已回血 ${fighter.healing}` : '');
  const elapsed = snapshot?.battle?.elapsedMs ?? 0;
  const itemStatus = [`道具 ${info?.loadout.items.length ?? 0}/${selectionLimit('items')}`];
  if (fighter?.items.staffAwakened) itemStatus.push('混元紫金棍');
  if (fighter?.items.equipped.includes('ascension-charm')) itemStatus.push(fighter.items.ascended ? '已飞升' : `飞升 ${Math.max(0, Math.ceil((180_000 - elapsed) / 1000))}s`);
  if (fighter && fighter.world.stunnedUntilMs > elapsed) itemStatus.push(`眩晕 ${((fighter.world.stunnedUntilMs - elapsed) / 1000).toFixed(1)}s`);
  if (fighter && fighter.world.invulnerableUntilMs > elapsed) itemStatus.push(`大奖无敌 ${Math.ceil((fighter.world.invulnerableUntilMs - elapsed) / 1000)}s`);
  if (fighter?.world.damageBonus) itemStatus.push(`所有伤害 +${fighter.world.damageBonus}`);
  const bombs = snapshot?.battle?.field.bombs.filter(bomb => bomb.holderId === fighter?.id) ?? [];
  if (bombs.length) itemStatus.push(`炸弹 ${bombs.map(bomb => `${Math.max(0, Math.ceil((bomb.explodesAtMs - elapsed) / 1000))}s`).join(' / ')}`);
  const debt = fighter?.items.debts.reduce((sum, payment) => sum + payment.remaining, 0) ?? 0;
  if (debt > 0) itemStatus.push(`待还 ${debt}`);
  if (fighter?.items.equipped.includes('rewind-tape')) itemStatus.push(fighter.items.rewindUsed ? '倒带已用' : '倒带待用');
  if (fighter?.items.refundAmount) itemStatus.push(`退货 ${fighter.items.refundAmount}`);
  set('.fighter-items', itemStatus.join(' · '));
  const itemNames = info?.loadout.items.map(id => ITEMS.find(item => item.id === id)!.name).join('、') || '未携带道具';
  const itemLabel = card.querySelector<HTMLElement>('.fighter-items')!;
  itemLabel.title = itemNames; itemLabel.setAttribute('aria-label', `${itemStatus.join('，')}；${itemNames}`);
  if (pet?.id === 'liangchushuo') {
    const yielding = !fighter?.liang || fighter.liang.phase === 'yield';
    const binding = fighter && fighter.boundUntilMs > elapsed ? `束缚 ${((fighter.boundUntilMs - elapsed) / 1000).toFixed(1)}s · ` : '';
    set('.effect-label', `${binding}${yielding ? `礼让 · 碰撞减伤 ${LIANG_REDUCTION}` : `回礼 · 碰撞伤害 +${LIANG_RETURN_BONUS}`}`);
    set('.fighter-loadout', snapshot?.phase === 'finished' ? '礼尚往来 · 本局结束' : '礼尚往来 · 每次碰撞交替');
    return;
  }
  if (fighter && !fighter.cheng && fighter.boundUntilMs > elapsed) set('.effect-label', `束缚 ${((fighter.boundUntilMs - elapsed) / 1000).toFixed(1)}s · 已回血 ${fighter.healing}`);
  if (fighter?.cheng) {
    const cheng = fighter.cheng;
    const invincible = cheng.invulnerableUntilMs > elapsed;
    set('.effect-label', `${invincible ? `无敌 ${((cheng.invulnerableUntilMs - elapsed) / 1000).toFixed(1)}s` : `保命${cheng.survivalUsed ? '已用' : '待用'}`} · 已吃 ${cheng.meals} 顿`);
    const meal = cheng.mealStartedAtMs !== null ? '扒饭中' : cheng.nextMealAtMs > elapsed ? `饭点 ${Math.ceil((cheng.nextMealAtMs - elapsed) / 1000)}s` : '低于50血自动吃饭';
    const grapple = fighter.boundUntilMs > elapsed ? `双方束缚 ${((fighter.boundUntilMs - elapsed) / 1000).toFixed(1)}s` : cheng.dash ? '飞扑兄弟' : !cheng.grappleUnlocked ? '30血解锁飞扑' : `飞扑 ${Math.max(0, Math.ceil((cheng.nextGrappleAtMs - elapsed) / 1000))}s`;
    set('.fighter-loadout', snapshot?.phase === 'finished' ? '一天八顿 · 本局结束' : `${meal} · ${grapple}`);
    return;
  }
  const rolling = fighter?.diceRoll && !fighter.diceRoll.resolved && elapsed < fighter.diceRoll.startedAtMs + HUTAO_ROLL_DURATION_MS;
  set('.fighter-loadout', pet?.id === 'hutao' ? snapshot?.phase === 'finished' ? '上嘴脸 · 本局结束' : rolling ? '上嘴脸 · 骰子投掷中' : `上嘴脸 · ${Math.ceil((HUTAO_ROLL_INTERVAL_MS - elapsed % HUTAO_ROLL_INTERVAL_MS) / 1000)} 秒后掷骰` : '');
}
function renderWorldRule() {
  const battle = snapshot?.battle;
  if (!battle) return;
  const world = battle.world;
  const rule = WORLD_EFFECTS.find(effect => effect.id === world.id)!;
  $('world-rule').style.setProperty('--world-color', rule.color);
  text('world-rule-name', rule.name);
  text('world-rule-description', rule.description);
  const seconds = Math.max(0, Math.ceil((world.nextAtMs - battle.elapsedMs) / 1000));
  const winner = battle.fighters.find(fighter => fighter.id === world.prizeWinnerId);
  text('world-rule-status', snapshot?.phase === 'finished' ? '本局结束' : world.scaleRemainingMs ? `暂停 · ${(world.scaleRemainingMs / 1000).toFixed(1)}s 后均分` : winner && world.prizeReward ? `${winner.name} · ${JACKPOT_LABELS[world.prizeReward]}` : world.prize ? `大奖剩余 ${Math.ceil((world.prize.expiresAtMs - battle.elapsedMs) / 1000)}s` : world.debris.some(junk => junk.landsAtMs > battle.elapsedMs) ? '注意落点 · 杂物即将砸落' : `${seconds}s 后触发`);
}
function addEvents(events: BattleEvent[]) {
  const log = $('battle-log');
  const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 60;
  if (events.length) log.querySelector('.log-empty')?.remove();
  for (const event of events) {
    const row = document.createElement('li'); row.dataset.kind = event.kind;
    const time = document.createElement('time'); time.textContent = `${(event.timeMs / 1000).toFixed(1)}s`;
    const description = document.createElement('span'); description.textContent = event.text;
    row.append(time, description); log.append(row);
  }
  while (log.childElementCount > 80) log.firstElementChild?.remove();
  if (atBottom) log.scrollTop = log.scrollHeight;
}
function renderResult() {
  const battle = snapshot?.battle;
  $('result').hidden = snapshot?.phase !== 'finished';
  if (!battle || snapshot?.phase !== 'finished') return;
  const winner = snapshot.players.find(p => p.id === battle.winnerId);
  text('result-title', battle.draw ? '势均力敌，平局！' : battle.winnerId === connection.playerId ? '这局，你赢了！' : `${winner?.name ?? '对手'}赢下了这局`);
  text('result-subtitle', `对战用时 ${(battle.elapsedMs / 1000).toFixed(1)} 秒 · ${isSpectator() ? '双方玩家同意再战后，可继续观战。' : '调整搭配，再试一场。'}`);
  const statsKey = JSON.stringify(battle.fighters);
  if ($('result-stats').dataset.key !== statsKey) {
    $('result-stats').dataset.key = statsKey; $('result-stats').replaceChildren();
    for (const fighter of battle.fighters) {
      const column = document.createElement('div'); const name = document.createElement('strong'); name.textContent = fighter.name;
      const line = document.createElement('span'); line.textContent = `伤害 ${fighter.damageDealt} · 治疗 ${fighter.healing} · 碰撞 ${fighter.hits}`; column.append(name, line); $('result-stats').append(column);
    }
  }
  const me = player(); const other = snapshot.players.find(p => p.id !== connection.playerId);
  $('rematch').hidden = isSpectator();
  $<HTMLButtonElement>('rematch').disabled = status !== 'connected' || !!me?.rematch || snapshot.players.length < 2;
  text('rematch', me?.rematch ? '已请求再战' : '再来一局');
  text('rematch-status', isSpectator() ? snapshot.players.some(p => p.rematch) ? '已有玩家请求再战，等待另一位玩家同意。' : '等待双方玩家决定是否再战。' : me?.rematch ? '等待好友同意，双方同意后返回搭配。' : other?.rematch ? '好友想再来一局，点击即可返回搭配。' : '双方同意后，可以重新调整搭配。');
}
connection.onSnapshot = (next, resumed) => {
  const first = snapshot === null;
  const previousPhase = snapshot?.phase;
  const wasSpectator = isSpectator();
  snapshot = next;
  $('room').dataset.phase = next.phase;
  const spectator = isSpectator();
  $('room').dataset.role = spectator ? 'spectator' : 'player';
  $('entry').hidden = true; $('room').hidden = false;
  const me = player();
  // Earlier server echoes must not undo rapid edits made while waiting.
  if (me && (first || resumed || wasSpectator || next.phase !== 'waiting' || previousPhase !== 'waiting')) draft = cloneLoadout(me.loadout);
  text('room-id', next.roomId);
  $<HTMLInputElement>('invite-url').value = shareUrl(next.roomId);
  if (first) { const url = new URL(location.href); url.searchParams.set('room', next.roomId); history.replaceState(null, '', url); }
  const freshMatch = matchId !== next.matchId;
  if (freshMatch || first || resumed) {
    matchId = next.matchId; lastEvent = 0; $('battle-log').replaceChildren();
    if (!next.events.length) { const empty = document.createElement('li'); empty.className = 'log-empty'; empty.textContent = '这里会记录碰撞、角色技能与生命变化。'; $('battle-log').append(empty); }
  }
  const events = next.events.filter(event => event.seq > lastEvent);
  if (events.length) lastEvent = events[events.length - 1]!.seq;
  addEvents(events);
  const combatVisible = next.phase === 'battle' || next.phase === 'finished';
  $('preparation').hidden = combatVisible; $('battle-view').hidden = !combatVisible;
  $('countdown').hidden = next.phase !== 'countdown';
  if (combatVisible) {
    renderer ??= new ArenaRenderer($<HTMLCanvasElement>('arena-canvas'));
    renderer.update(next, resumed || first ? [] : events, resumed || first);
    renderPlayer(0, next.players[0]); renderPlayer(1, next.players[1]);
    renderWorldRule();
  } else if (renderer) { renderer.destroy(); renderer = null; }
  renderSeat(0, next.players[0]); renderSeat(1, next.players[1]); renderMembers(); renderChoices(); renderResult();
  text('phase-label', ({ waiting: '等待准备', countdown: '即将开战', battle: '对战进行中', finished: '本局结束' })[next.phase]);
  text('event-count', next.events.length ? `${lastEvent} 条战斗事件` : '等待开战');
  text('arena-caption', next.phase === 'waiting' ? '双方准备后，比赛自动开始' : next.phase === 'countdown' ? '搭配已锁定，准备开战' : next.phase === 'battle' ? '自动弹跳 · 碰撞造成伤害' : spectator ? '本局已结束，等待双方玩家再战' : '本局已结束，可以发起再战');
  document.querySelector('.room-heading h1')!.textContent = next.phase === 'battle' ? '碰个胜负' : next.phase === 'finished' ? '这场碰撞，落下帷幕' : spectator ? '观众席，准备观战' : '选择你的出战小球';
  text('room-subtitle', next.phase === 'finished' ? spectator ? '本局已结束，你可以查看战况或在有空位时加入对战。' : '本局已结束，查看战况、切换席位或发起再战。' : combatVisible ? '自动对战中，战况与结果由服务器实时同步。' : spectator ? '你在观众席，双方玩家准备后自动开战。' : '先选搭配，双方准备后自动开战。');
  if (previousPhase !== next.phase && (next.phase === 'battle' || next.phase === 'countdown')) $(next.phase === 'battle' ? 'battle-view' : 'room').scrollIntoView({ block: 'start', behavior: 'auto' });
};
connection.onStatus = next => {
  status = next;
  const labels = { idle: '好友对战', connecting: '连接中', connected: '已连接', reconnecting: '正在重连', closed: '连接已结束' };
  $('connection').querySelector('span')!.textContent = labels[next]; $('connection').dataset.state = next;
  if (snapshot) { renderMembers(); renderChoices(); renderResult(); }
};
connection.onError = message => { toast(message); text('entry-status', message); };
function showEntry() {
  snapshot = null; matchId = ''; lastEvent = 0;
  renderer?.destroy(); renderer = null; loadoutView.reset();
  $('entry').hidden = false; $('room').hidden = true;
  roomCode.value = new URL(location.href).searchParams.get('room') || '';
}
connection.onExit = showEntry;

async function enter(create: boolean) {
  if (pending) return;
  const name = nickname.value.trim();
  if (!name) { toast('请输入昵称，不能只填写空格。'); nickname.reportValidity(); nickname.focus(); return; }
  let code = roomCode.value.trim();
  if (!create) {
    try { if (/^https?:\/\//i.test(code)) code = new URL(code).searchParams.get('room') || ''; } catch { code = ''; }
    if (!code) { toast('请输入好友的房间码。'); roomCode.focus(); return; }
  }
  writeStorage('local', 'pet-arena:name', name); busy(true);
  const success = create ? await connection.create(name) : await connection.join(code, name);
  busy(false);
  if (!success) text('entry-status', '未能进入房间，请检查上方提示后重试。');
}
$('entry-form').addEventListener('submit', event => { event.preventDefault(); void enter(!roomCode.value.trim()); });
$('create').addEventListener('click', event => { event.preventDefault(); void enter(true); });
$('join').addEventListener('click', () => { void enter(false); });
$('ready').addEventListener('click', () => { if (player() && validateLoadout(draft) && snapshot?.phase === 'waiting' && status === 'connected') connection.ready(!player()?.ready); });
$('rematch').addEventListener('click', () => { if (player()) connection.rematch(); });
$('switch-seat').addEventListener('click', () => {
  if (status === 'connected' && !$<HTMLButtonElement>('switch-seat').disabled) connection.switchSeat(isSpectator() ? 'player' : 'spectator');
});
$('leave').addEventListener('click', async () => {
  try { await connection.leave(); } catch { /* Leaving also works when the socket is already unavailable. */ }
  const url = new URL(location.href); url.searchParams.delete('room'); history.replaceState(null, '', url); showEntry();
});
$('copy-link').addEventListener('click', async () => {
  const field = $<HTMLInputElement>('invite-url');
  try { await navigator.clipboard.writeText(field.value); toast('邀请链接已复制，发给好友吧。'); }
  catch { field.focus(); field.select(); field.setSelectionRange(0, field.value.length); toast('链接已选中，请长按或按 Ctrl+C 复制。'); }
});
setInterval(() => {
  if (!snapshot) return;
  const elapsed = snapshot.battle?.elapsedMs ?? 0;
  text('battle-clock', `${String(Math.floor(elapsed / 60000)).padStart(2, '0')}:${String(Math.floor(elapsed / 1000) % 60).padStart(2, '0')}`);
  if (snapshot.phase === 'countdown') text('countdown-number', String(Math.max(1, Math.ceil((snapshot.startAt - connection.serverNow) / 1000))));
}, 100);
void connection.config().then(config => { serverInfo = config; if (snapshot) $<HTMLInputElement>('invite-url').value = shareUrl(snapshot.roomId); });
busy(true);
void connection.restore().finally(() => busy(false));
