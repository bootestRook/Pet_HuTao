import type { ChengGrapple, FighterState } from '../shared/types.js';
import { ARENA_SIZE } from '../shared/catalog.js';
import { CHENG_BIND_DURATION_MS, CHENG_INVULNERABLE_MS, CHENG_MEAL_DURATION_MS } from '../shared/chengzhiquan.js';

const clamp = (value: number, margin: number) => Math.max(margin, Math.min(ARENA_SIZE - margin, value));

/** Small, code-native character art shares the existing ball collision outline. */
export function drawChengzhiquan(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, fighter: FighterState, elapsed: number, reduced: boolean, foodSide: number) {
  const cheng = fighter.cheng!;
  const eating = cheng.mealStartedAtMs !== null;
  const angry = !!cheng.dash;
  ctx.save(); ctx.translate(x, y); ctx.scale(radius / 32, radius / 32);
  ctx.save(); ctx.beginPath(); ctx.arc(0, 0, 30.5, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = '#624531'; ctx.beginPath(); ctx.ellipse(0, 33, 29, 12, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f3d2a7';
  for (const side of [-1, 1]) { ctx.beginPath(); ctx.ellipse(side * 19, 11, eating ? 10 : 7, eating ? 8 : 5, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
  // A scalloped silhouette and individual curls stay recognizable at radius 32.
  ctx.fillStyle = '#352a25'; ctx.strokeStyle = '#70503a'; ctx.lineWidth = 1.2;
  for (let i = 0; i < 7; i++) {
    const hx = -22 + i * 7.3, hy = -20 - Math.sin(i / 6 * Math.PI) * 5 - (angry && i % 2 ? 3 : 0);
    ctx.beginPath(); ctx.arc(hx, hy, 6.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(hx + 0.5, hy - 0.5, 3.3, -0.3, Math.PI * 1.4); ctx.stroke();
  }
  const slip = cheng.survivalUsed ? 2 : 0;
  ctx.strokeStyle = '#24272b'; ctx.lineWidth = 2.7; ctx.lineCap = 'round';
  ctx.fillStyle = '#fff2d933';
  for (const gx of [-12, 12]) { ctx.beginPath(); ctx.arc(gx, -2 + slip, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(-3, -3 + slip); ctx.quadraticCurveTo(0, -5 + slip, 3, -3 + slip); ctx.moveTo(-26, -3); ctx.lineTo(-21, -2 + slip); ctx.moveTo(21, -2 + slip); ctx.lineTo(26, -3); ctx.stroke();
  for (const side of [-1, 1]) {
    ctx.beginPath();
    if (angry) { ctx.moveTo(side * 17, -13); ctx.lineTo(side * 7, -9); }
    else { ctx.moveTo(side * 17, -13); ctx.quadraticCurveTo(side * 12, -15, side * 7, -13); }
    ctx.stroke();
    ctx.beginPath(); ctx.moveTo(side * 15, -1); ctx.quadraticCurveTo(side * 12, eating ? -4 : -3, side * 9, -1); ctx.stroke();
  }
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-7, 14); ctx.quadraticCurveTo(0, eating ? 11 : 22, 8, 13); ctx.stroke();
  ctx.fillStyle = '#fff2cf'; ctx.beginPath(); ctx.ellipse(12, 16, 2.8, 1.8, -0.3, 0, Math.PI * 2); ctx.fill();
  if (angry) { ctx.strokeStyle = '#fff2c9'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-17, -6); ctx.lineTo(-9, 0); ctx.moveTo(7, -6); ctx.lineTo(15, 0); ctx.stroke(); }
  ctx.restore();

  if (cheng.invulnerableUntilMs > elapsed) {
    const left = cheng.invulnerableUntilMs - elapsed;
    ctx.save(); ctx.strokeStyle = '#efc76c'; ctx.fillStyle = '#efc76c13'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, radius + 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(x, y, radius + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left / CHENG_INVULNERABLE_MS); ctx.stroke();
    if (left < 1000) { ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + 21, y - 29); ctx.lineTo(x + 14, y - 19); ctx.lineTo(x + 21, y - 13); ctx.stroke(); }
    ctx.fillStyle = '#ffe3a1'; ctx.font = '700 10px "Microsoft YaHei", sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`无敌 ${(left / 1000).toFixed(1)}s`, clamp(x, 45), clamp(y < 90 ? y + radius + 24 : y - radius - 11, 12)); ctx.restore();
  }
  if (eating) {
    const progress = Math.max(0, Math.min(1, (elapsed - cheng.mealStartedAtMs!) / CHENG_MEAL_DURATION_MS));
    const sideX = x + foodSide * 48;
    const nearEdge = sideX < 22 || sideX > ARENA_SIZE - 22;
    const bx = nearEdge ? clamp(x - foodSide * 64, 22) : sideX;
    const by = nearEdge ? clamp(y + (y < ARENA_SIZE / 2 ? 64 : -64), 26) : clamp(y + 8, 26);
    const lift = reduced ? 0 : Math.sin(progress * Math.PI * 4) * 5;
    ctx.save(); ctx.translate(bx, by);
    ctx.strokeStyle = '#72523a'; ctx.lineWidth = 1.5; ctx.fillStyle = '#fff1d2';
    ctx.beginPath(); ctx.ellipse(0, -3, 13, 7, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e78354'; ctx.beginPath(); ctx.moveTo(-13, -2); ctx.quadraticCurveTo(-10, 13, 0, 13); ctx.quadraticCurveTo(10, 13, 13, -2); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#f9df99'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-8, -12 + lift); ctx.lineTo(10, -5 + lift); ctx.moveTo(-6, -16 + lift); ctx.lineTo(12, -9 + lift); ctx.stroke();
    ctx.fillStyle = '#fff4d4'; ctx.beginPath(); ctx.ellipse(7, -10 + lift, 3.5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

export function drawBound(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  ctx.save(); ctx.strokeStyle = '#f2b875'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y, radius + 3, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y, radius + 3, 1.15 * Math.PI, 1.85 * Math.PI); ctx.stroke();
  const lx = clamp(x + 26, 12), ly = clamp(y - 27, 12);
  ctx.fillStyle = '#efbb71'; ctx.beginPath(); ctx.roundRect(lx - 5, ly - 2, 10, 8, 2); ctx.fill();
  ctx.beginPath(); ctx.arc(lx, ly - 3, 3.5, Math.PI, 0); ctx.stroke();
  ctx.restore();
}

export function drawBrotherLink(ctx: CanvasRenderingContext2D, source: { x: number; y: number }, target: { x: number; y: number }, grapple: ChengGrapple, elapsed: number, reduced: boolean) {
  const dx = target.x - source.x, dy = target.y - source.y, length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length, ny = dx / length;
  ctx.save(); ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    ctx.strokeStyle = '#62412d'; ctx.lineWidth = 8;
    const path = () => { ctx.beginPath(); ctx.moveTo(source.x + nx * 35 * side, source.y + ny * 35 * side); ctx.quadraticCurveTo((source.x + target.x) / 2 + nx * 52 * side, (source.y + target.y) / 2 + ny * 52 * side, target.x + nx * 35 * side, target.y + ny * 35 * side); ctx.stroke(); };
    path(); ctx.strokeStyle = '#e7b78b'; ctx.lineWidth = 5; path();
  }
  const middleX = (source.x + target.x) / 2, middleY = (source.y + target.y) / 2;
  ctx.fillStyle = '#ffd9a1'; ctx.strokeStyle = '#10191c'; ctx.lineWidth = 3;
  ctx.font = '700 10px "Microsoft YaHei", sans-serif'; ctx.textAlign = 'center';
  const label = `双方束缚 ${(Math.max(0, grapple.startedAtMs + CHENG_BIND_DURATION_MS - elapsed) / 1000).toFixed(1)}s`;
  const labelX = clamp(middleX, 50), labelY = clamp(middleY < 100 ? middleY + 82 : middleY - 65, 12);
  ctx.strokeText(label, labelX, labelY); ctx.fillText(label, labelX, labelY);
  if (!reduced && elapsed < grapple.startedAtMs + CHENG_BIND_DURATION_MS) {
    const progress = ((elapsed - grapple.startedAtMs) % 1000) / 1000;
    ctx.fillStyle = '#a6efc2'; ctx.shadowColor = '#7fe7b0'; ctx.shadowBlur = 7;
    ctx.beginPath(); ctx.arc(target.x - dx * progress, target.y - dy * progress - 33, 3.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
