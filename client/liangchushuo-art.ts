import type { LiangState } from '../shared/types.js';
import { LIANG_RETURN_DURATION_MS, LIANG_YIELD_DURATION_MS } from '../shared/liangchushuo.js';

/** Two swept curtains, transparent square glasses and a small tailored collar. */
export function drawLiangchushuo(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, liang: LiangState, elapsed: number, reduced: boolean, hit: boolean, active: boolean) {
  const contact = liang.contact;
  const age = contact ? elapsed - contact.timeMs : Infinity;
  const yielding = active && contact?.phase === 'yield' && age >= 0 && age < LIANG_YIELD_DURATION_MS;
  const returning = active && contact?.phase === 'return' && age >= 0 && age < LIANG_RETURN_DURATION_MS;
  const nod = yielding && !reduced ? Math.sin(age / LIANG_YIELD_DURATION_MS * Math.PI) * 2.5 : 0;
  ctx.save(); ctx.translate(x, y); ctx.scale(radius / 32, radius / 32);
  ctx.save(); ctx.beginPath(); ctx.arc(0, 0, 30.5, 0, Math.PI * 2); ctx.clip();
  const skin = ctx.createLinearGradient(-22, -25, 26, 30);
  skin.addColorStop(0, '#fff9ed'); skin.addColorStop(1, '#e5cdb0');
  ctx.fillStyle = skin; ctx.fillRect(-32, -32, 64, 64);
  ctx.fillStyle = '#24374a'; ctx.beginPath(); ctx.moveTo(-30, 31); ctx.lineTo(-15, 21); ctx.lineTo(0, 26); ctx.lineTo(15, 21); ctx.lineTo(30, 31); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#e9cc8b'; ctx.lineWidth = 1.7;
  ctx.beginPath(); ctx.moveTo(-15, 22); ctx.lineTo(-7, 29); ctx.lineTo(0, 25); ctx.lineTo(7, 29); ctx.lineTo(15, 22); ctx.stroke();
  ctx.translate(0, nod);
  // Hair leaves a distinct central part and keeps both eyes unobscured.
  ctx.fillStyle = '#18232c';
  ctx.beginPath(); ctx.moveTo(-31, -3); ctx.bezierCurveTo(-35, -28, -15, -39, -1, -28); ctx.bezierCurveTo(-3, -16, -15, -11, -24, -8); ctx.lineTo(-29, 3); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(1, -28); ctx.bezierCurveTo(18, -39, 36, -24, 31, 1); ctx.lineTo(25, -9); ctx.bezierCurveTo(12, -10, 4, -17, 1, -28); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#53606a'; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-6, -27); ctx.quadraticCurveTo(-19, -25, -24, -15); ctx.moveTo(7, -27); ctx.quadraticCurveTo(21, -25, 26, -13); ctx.stroke();
  ctx.strokeStyle = '#27333b'; ctx.lineWidth = 2;
  for (const side of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(side * 7, -9); ctx.quadraticCurveTo(side * 13, -12, side * 19, -9); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(side * 7, -1); ctx.quadraticCurveTo(side * 13, -4, side * 18, -1); ctx.stroke();
    ctx.fillStyle = '#24374a'; ctx.beginPath(); ctx.ellipse(side * 12, 0, 1.7, 2.5, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.save(); ctx.translate(0, hit && !reduced ? 1.5 : 0); if (hit && !reduced) ctx.rotate(-0.04);
  ctx.fillStyle = '#cbe7ed16'; ctx.strokeStyle = '#726449'; ctx.lineWidth = 1.6;
  for (const gx of [-22, 4]) { ctx.beginPath(); ctx.roundRect(gx, -6, 18, 13, 3); ctx.fill(); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(-4, -2); ctx.quadraticCurveTo(0, -4, 4, -2); ctx.moveTo(-27, -5); ctx.lineTo(-22, -3); ctx.moveTo(22, -3); ctx.lineTo(27, -5); ctx.stroke();
  if (returning && !reduced) {
    ctx.globalAlpha = 1 - age / LIANG_RETURN_DURATION_MS; ctx.strokeStyle = '#fff9d5'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(8, -6); ctx.lineTo(18, 6); ctx.moveTo(13, -6); ctx.lineTo(22, 3); ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = '#946d53'; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(1, 5); ctx.lineTo(-1, 10); ctx.lineTo(2, 11); ctx.stroke();
  ctx.strokeStyle = '#574335'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(-7, 15); ctx.quadraticCurveTo(1, hit ? 15 : 20, 9, 13); ctx.stroke();
  ctx.restore();
  if (active) {
    ctx.lineCap = 'round'; ctx.lineWidth = 2.4;
    ctx.strokeStyle = liang.phase === 'yield' ? '#9cd8ed' : '#e8c681';
    ctx.beginPath();
    if (liang.phase === 'yield') ctx.arc(0, 0, 29, Math.PI * 0.15, Math.PI * 0.85);
    else for (const side of [-1, 1]) { ctx.moveTo(side * 28, 11); ctx.lineTo(side * 24, 17); ctx.moveTo(side * 25, 9); ctx.lineTo(side * 21, 15); }
    ctx.stroke();
    if (yielding) {
      ctx.globalAlpha = 1 - age / LIANG_YIELD_DURATION_MS; ctx.strokeStyle = '#b4ecff'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(0, 0, 36, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
    }
    if (returning && !reduced) {
      ctx.globalAlpha = 1 - age / LIANG_RETURN_DURATION_MS; ctx.strokeStyle = '#ffe0a0'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(-16, 23); ctx.lineTo(-8, 29); ctx.moveTo(8, 29); ctx.lineTo(16, 23); ctx.stroke();
    }
  }
  ctx.restore();
}
