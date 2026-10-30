/** Code-native ball art stays sharp at both mobile and desktop canvas resolutions. */
export function drawHutao(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, embarrassed: boolean, nostalgiaUsed: boolean) {
  ctx.save(); ctx.translate(x, y); ctx.scale(radius / 32, radius / 32);
  ctx.save(); ctx.beginPath(); ctx.arc(0, 0, 30.5, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = '#303b40'; ctx.fillRect(-32, -32, 64, 15);
  ctx.fillStyle = '#5fbdbb'; ctx.fillRect(-32, -23, 64, 8);
  ctx.restore();
  // A boastful little crown, three studs for the three-games-a-year easter egg.
  ctx.save(); ctx.translate(0, -21); if (embarrassed) ctx.rotate(0.3);
  ctx.fillStyle = '#e8bb61'; ctx.strokeStyle = '#665131'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-7, 3); ctx.lineTo(-9, -5); ctx.lineTo(-3, -1); ctx.lineTo(0, -7); ctx.lineTo(3, -1); ctx.lineTo(9, -5); ctx.lineTo(7, 3); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  for (const px of [-16, 0, 16]) { ctx.fillStyle = '#faedcd'; ctx.beginPath(); ctx.arc(px, -12.5, 1.5, 0, Math.PI * 2); ctx.fill(); }
  const drop = embarrassed ? 4 : 0;
  ctx.strokeStyle = '#26353a'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-19, -6); ctx.lineTo(-7, -9); ctx.moveTo(7, -9); ctx.lineTo(19, -5); ctx.stroke();
  ctx.fillStyle = '#f5fcfb66';
  for (const gx of [-20, 4]) { ctx.beginPath(); ctx.roundRect(gx, -4 + drop, 16, 12, 3); ctx.fill(); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(-4, 1 + drop); ctx.quadraticCurveTo(0, -2 + drop, 4, 1 + drop); ctx.moveTo(-25, -1 + drop); ctx.lineTo(-20, 0 + drop); ctx.moveTo(20, 0 + drop); ctx.lineTo(25, -1 + drop); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-15, 1); ctx.lineTo(-9, 1); ctx.moveTo(9, 1); ctx.lineTo(15, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-7, 15); ctx.quadraticCurveTo(4, embarrassed ? 10 : 21, 13, 11); ctx.stroke();
  if (embarrassed) {
    ctx.fillStyle = '#55aacc'; ctx.beginPath(); ctx.moveTo(24, -8); ctx.quadraticCurveTo(16, 3, 24, 4); ctx.quadraticCurveTo(30, 2, 24, -8); ctx.fill();
  }
  ctx.fillStyle = nostalgiaUsed ? '#8c8876' : '#dca957';
  ctx.beginPath(); ctx.arc(-21, 15, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

export function drawSlap(ctx: CanvasRenderingContext2D, x: number, y: number, progress: number, reduced: boolean) {
  ctx.save(); ctx.translate(x + (reduced ? 0 : 35 * Math.max(0, 1 - progress * 3)), y - 4);
  if (!reduced) ctx.rotate(-0.45 + Math.min(1, progress * 3) * 0.65);
  ctx.fillStyle = '#f3c69e'; ctx.strokeStyle = '#8c593b'; ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.roundRect(-12, -10, 27, 29, 8); ctx.fill(); ctx.stroke();
  for (let finger = 0; finger < 4; finger++) {
    ctx.beginPath(); ctx.roundRect(-12 + finger * 7, -28 + Math.abs(1.5 - finger) * 4, 7, 25, 3.5); ctx.fill(); ctx.stroke();
  }
  ctx.beginPath(); ctx.roundRect(-21, -3, 12, 22, 5); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#ffe3a0'; ctx.lineWidth = 2;
  for (const side of [-1, 1]) { ctx.beginPath(); ctx.moveTo(side * 25, -13); ctx.lineTo(side * 32, -20); ctx.moveTo(side * 27, 0); ctx.lineTo(side * 36, 0); ctx.stroke(); }
  ctx.restore();
}
