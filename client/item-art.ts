import { ARENA_SIZE } from '../shared/catalog.js';
import { ITEM_RULES as R } from '../shared/items.js';
import type { BattleEvent, FighterState, ItemFieldState } from '../shared/types.js';

const limit = (value: number, inset: number) => Math.max(inset, Math.min(ARENA_SIZE - inset, value));
function pill(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  ctx.font = '700 10px "Microsoft YaHei", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const width = ctx.measureText(text).width + 12;
  x = limit(x, width / 2 + 3); y = limit(y, 10);
  ctx.fillStyle = '#142328'; ctx.strokeStyle = color; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(x - width / 2, y - 8, width, 16, 4); ctx.fill(); ctx.stroke();
  ctx.fillStyle = color; ctx.fillText(text, x, y);
}

export function drawItemField(ctx: CanvasRenderingContext2D, field: ItemFieldState, before: ItemFieldState | undefined, alpha: number, elapsed: number, reduced: boolean) {
  for (const peel of field.bananas) {
    ctx.save(); ctx.translate(peel.x, peel.y); ctx.globalAlpha = peel.armed ? 1 : 0.4;
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#b97d29'; ctx.fillStyle = '#ffda63';
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.quadraticCurveTo(-4, -1, -15, 7); ctx.quadraticCurveTo(-7, 12, 0, 1); ctx.quadraticCurveTo(5, 13, 15, 6); ctx.quadraticCurveTo(6, 4, 2, -4); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(3, -12); ctx.stroke();
    ctx.strokeStyle = '#ffda6360'; ctx.beginPath(); ctx.arc(0, 0, R.banana.radius + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, (peel.expiresAtMs - elapsed) / R.banana.lifetimeMs)); ctx.stroke();
    ctx.restore();
  }
  for (const pearl of field.pearls) {
    ctx.save();
    ctx.globalAlpha = !reduced && pearl.expiresAtMs - elapsed < 2000 ? 0.65 + Math.sin(elapsed / 130) * 0.25 : 1;
    ctx.fillStyle = '#a8e6cf24'; ctx.beginPath(); ctx.arc(pearl.x, pearl.y, 15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#735044'; ctx.strokeStyle = '#f0d3a0'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(pearl.x, pearl.y, R.pearl.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e8cfb1'; ctx.beginPath(); ctx.arc(pearl.x - 2.5, pearl.y - 3, 2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#a8e6cf'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(pearl.x + 10, pearl.y - 12); ctx.lineTo(pearl.x + 10, pearl.y - 5); ctx.moveTo(pearl.x + 6.5, pearl.y - 8.5); ctx.lineTo(pearl.x + 13.5, pearl.y - 8.5); ctx.stroke();
    ctx.restore();
  }
  for (const punch of field.punches) {
    const previous = before?.punches.find(p => p.id === punch.id);
    const x = previous ? previous.x + (punch.x - previous.x) * alpha : punch.x;
    const y = previous ? previous.y + (punch.y - previous.y) * alpha : punch.y;
    ctx.save(); ctx.strokeStyle = '#a2b3b9'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(punch.originX, punch.originY);
    const length = Math.hypot(x - punch.originX, y - punch.originY);
    for (let i = 1; i <= 12; i++) {
      const along = length * i / 12, offset = i === 12 ? 0 : (i % 2 ? 4 : -4);
      ctx.lineTo(punch.originX + punch.dx * along - punch.dy * offset, punch.originY + punch.dy * along + punch.dx * offset);
    }
    ctx.stroke(); ctx.translate(x, y); ctx.rotate(Math.atan2(punch.dy, punch.dx));
    ctx.fillStyle = '#df695c'; ctx.strokeStyle = '#ffcc9b'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(-12, -12, 25, 24, 8); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(5, -10); ctx.lineTo(5, 3); ctx.moveTo(-2, -10); ctx.lineTo(-2, 1); ctx.stroke(); ctx.restore();
    if (elapsed < punch.launchAtMs) pill(ctx, '!', x + punch.dx * 25, y + punch.dy * 25, '#ffb28f');
  }
}

export function drawCarriedItems(ctx: CanvasRenderingContext2D, fighter: FighterState, x: number, y: number, field: ItemFieldState, elapsed: number, reduced: boolean) {
  if (fighter.hp <= 0) return;
  const items = fighter.items, side = x < ARENA_SIZE / 2 ? 1 : -1;
  if (items.equipped.includes('plain-club')) {
    ctx.save(); ctx.translate(limit(x + side * (fighter.radius + 9), 16), limit(y - 8, 25)); ctx.rotate(side * 0.24);
    ctx.strokeStyle = items.staffAwakened ? '#dbacff' : '#ac8253'; ctx.lineWidth = items.staffAwakened ? 7 : 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -19); ctx.lineTo(0, 19); ctx.stroke();
    ctx.strokeStyle = items.staffAwakened ? '#ffdb7e' : '#dbbc84'; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(0, -17); ctx.lineTo(0, -11); ctx.moveTo(0, 11); ctx.lineTo(0, 17); ctx.stroke(); ctx.restore();
  }
  if (items.equipped.includes('thorn-armor')) {
    ctx.save(); ctx.fillStyle = '#9eafb7'; ctx.strokeStyle = '#d7e5df'; ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4, r = fighter.radius + 2;
      ctx.beginPath(); ctx.moveTo(x + Math.cos(angle - 0.07) * r, y + Math.sin(angle - 0.07) * r);
      ctx.lineTo(x + Math.cos(angle) * (r + 6), y + Math.sin(angle) * (r + 6));
      ctx.lineTo(x + Math.cos(angle + 0.07) * r, y + Math.sin(angle + 0.07) * r); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }
  if (items.ascended) {
    ctx.save(); ctx.strokeStyle = '#e9bdff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, fighter.radius + 11, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#ffe1a0';
    for (const wing of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x + wing * (fighter.radius + 8), y); ctx.lineTo(x + wing * (fighter.radius + 20), y - 13); ctx.lineTo(x + wing * (fighter.radius + 24), y - 4); ctx.stroke(); }
    ctx.restore();
  }
  if (items.equipped.includes('healing-orb')) {
    const ox = limit(x - fighter.radius * 0.65, 9), oy = limit(y - fighter.radius - 11, 9);
    ctx.save(); ctx.fillStyle = '#86e4cc'; ctx.strokeStyle = '#e2fff0'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(ox, oy, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ox - 3, oy); ctx.lineTo(ox + 3, oy); ctx.moveTo(ox, oy - 3); ctx.lineTo(ox, oy + 3); ctx.stroke(); ctx.restore();
  }
  const bombs = field.bombs.filter(bomb => bomb.holderId === fighter.id);
  bombs.forEach((bomb, index) => {
    const seconds = Math.max(0, Math.ceil((bomb.explodesAtMs - elapsed) / 1000));
    const bx = limit(x + side * (fighter.radius + 23 + index * 32), 24), by = limit(y + 23, 27);
    ctx.save(); ctx.translate(bx, by);
    if (!reduced && seconds <= 3) ctx.rotate(Math.sin(elapsed / 45) * 0.1);
    ctx.fillStyle = seconds <= 3 ? '#a9443c' : '#bd8a54'; ctx.strokeStyle = '#f6d9a4'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(-13, -12, 26, 24, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ecd7b2'; ctx.fillRect(-3, -12, 6, 24); ctx.fillRect(-13, -2, 26, 4);
    ctx.strokeStyle = '#f8bf64'; ctx.beginPath(); ctx.moveTo(3, -13); ctx.quadraticCurveTo(12, -25, 17, -15); ctx.stroke();
    ctx.fillStyle = '#ffbd72'; ctx.beginPath(); ctx.arc(17, -15, 2.5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    pill(ctx, `${seconds}s`, bx, by + 23, seconds <= 3 ? '#ffb29e' : '#ffe0a4');
  });
  if (items.refundAmount > 0 && elapsed < items.refundExpiresAtMs) {
    const rx = limit(x - side * (fighter.radius + 22), 22), ry = limit(y + 18, 24);
    ctx.save(); ctx.fillStyle = '#f4ebd5'; ctx.beginPath(); ctx.roundRect(rx - 15, ry - 11, 30, 22, 3); ctx.fill();
    ctx.strokeStyle = '#243139'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.moveTo(rx - 11 + i * 2.7, ry - 7); ctx.lineTo(rx - 11 + i * 2.7, ry + (i % 3 ? 5 : 8)); ctx.stroke(); }
    ctx.restore(); pill(ctx, `退 ${items.refundAmount}`, rx, ry + 22, '#f4dc9d');
  }
  if (items.teleportStartedAtMs !== null) {
    const tx = limit(x, 27), ty = limit(y + fighter.radius + 18, 22);
    ctx.save(); ctx.fillStyle = '#d9e9e8'; ctx.strokeStyle = '#8db3bb'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(tx - 18, ty - 18, 36, 13, 4); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(tx, ty, 24, 11, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#438f9f'; ctx.beginPath(); ctx.ellipse(tx, ty, 16, 6, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  if (items.pumpedUntilMs > elapsed) {
    ctx.save(); ctx.strokeStyle = '#f2ce77'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.arc(x, y, fighter.radius + 6, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
  if (items.slipUntilMs > elapsed) {
    ctx.save(); ctx.strokeStyle = '#ffda63'; ctx.lineWidth = 2;
    const angle = Math.atan2(fighter.vy, fighter.vx);
    for (const offset of [-5, 5]) {
      ctx.beginPath(); ctx.moveTo(x - Math.cos(angle) * (fighter.radius + 4) - Math.sin(angle) * offset, y - Math.sin(angle) * (fighter.radius + 4) + Math.cos(angle) * offset);
      ctx.lineTo(x - Math.cos(angle) * (fighter.radius + 16) - Math.sin(angle) * offset, y - Math.sin(angle) * (fighter.radius + 16) + Math.cos(angle) * offset); ctx.stroke();
    }
    ctx.restore();
  }
}

export function drawItemBurst(ctx: CanvasRenderingContext2D, event: BattleEvent, x: number, y: number, age: number, reduced: boolean) {
  const bomb = event.effect === 'bomb' && event.kind === 'item' && event.text.includes('爆炸');
  const ticket = event.effect === 'lucky-ticket' && event.kind === 'item';
  if (bomb || ticket) {
    ctx.save(); ctx.globalAlpha = (1 - age) * 0.85;
    const radius = ticket ? 30 : 48;
    const reach = reduced ? radius : radius * (0.25 + age * 0.75);
    ctx.strokeStyle = '#ff9c71'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, reach, 0, Math.PI * 2); ctx.stroke();
    for (let i = 0; i < 12; i++) {
      const angle = i * Math.PI / 6;
      ctx.strokeStyle = i % 2 ? '#99e4d6' : '#ffcf7a';
      ctx.beginPath(); ctx.moveTo(x + Math.cos(angle) * reach * 0.65, y + Math.sin(angle) * reach * 0.65); ctx.lineTo(x + Math.cos(angle) * reach, y + Math.sin(angle) * reach); ctx.stroke();
    }
    ctx.restore();
  }
  if (event.kind === 'rewind') {
    ctx.save(); ctx.globalAlpha = 1 - age; ctx.strokeStyle = '#b6b8ff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, 39 + (reduced ? 0 : age * 24), Math.PI * 0.2, Math.PI * 1.8); ctx.stroke();
    ctx.fillStyle = '#b6b8ff'; ctx.beginPath(); ctx.moveTo(x + 31, y - 27); ctx.lineTo(x + 18, y - 27); ctx.lineTo(x + 31, y - 40); ctx.closePath(); ctx.fill(); ctx.restore();
  }
}

export function itemEventLabel(event: BattleEvent): string | null {
  if (event.kind === 'rewind') return `倒带 ${event.amount >= 0 ? '+' : '−'}${Math.abs(event.amount)}`;
  if (event.kind !== 'item') return null;
  if (event.effect === 'lucky-ticket') return event.text.includes('中奖') ? '中奖，满血！' : '下次一定中！';
  if (event.effect === 'staff') return event.amount > 0 ? `追加 ×${event.amount}` : '混元紫金棍！';
  if (event.effect === 'ascension') return '飞升！';
  if (event.effect === 'banana' && event.text.includes('踩到')) return '谁扔的？！';
  if (event.effect === 'toilet' && event.text.includes('冲到了')) return '冲走！';
  if (event.effect === 'bomb') return event.text.includes('爆炸') ? '签收爆炸！' : '拒收！';
  if (event.effect === 'pump' && event.text.includes('过度')) return '膨胀了！';
  return null;
}
