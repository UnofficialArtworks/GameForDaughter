// Procedural icon art shared by the world canvas and the DOM UI (via data URLs).
import { COLLECTIBLES, DECOR, WEARABLES } from './data';
import { ellipse, heartPath, starPath, roundRect, shade } from './util';

const OL = '#4a3340';

function fs(ctx: CanvasRenderingContext2D, fill: string | CanvasGradient, lw = 2.2, stroke = OL) {
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke();
}

/** Draw icon `id` centred at the origin, fitting in a box of `size`. */
export function drawIcon(ctx: CanvasRenderingContext2D, id: string, size: number) {
  ctx.save();
  const k = size / 40;
  ctx.scale(k, k);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const fn = ICONS[id];
  if (fn) fn(ctx);
  else if (id.startsWith('c:')) drawCollectible(ctx, id.slice(2));
  else if (id.startsWith('w:')) drawWearIcon(ctx, id.slice(2));
  else if (id.startsWith('d:')) drawDecorIcon(ctx, id.slice(2));
  else { ctx.fillStyle = '#ccc'; ellipse(ctx, 0, 0, 12, 12); ctx.fill(); }
  ctx.restore();
}

const ICONS: Record<string, (ctx: CanvasRenderingContext2D) => void> = {
  kibble: (c) => {
    // bowl with kibble
    c.beginPath(); c.moveTo(-17, -2); c.quadraticCurveTo(-15, 15, 0, 15); c.quadraticCurveTo(15, 15, 17, -2); c.closePath();
    for (const [x, y] of [[-9, -4], [-2, -7], [5, -5], [10, -2], [-5, -1], [2, -2]]) { ellipse(c, x, y, 4.5, 3.5, x * 0.1); fs(c, '#c9853f', 1.5); }
    c.beginPath(); c.moveTo(-17, -2); c.quadraticCurveTo(-15, 15, 0, 15); c.quadraticCurveTo(15, 15, 17, -2); c.closePath();
    fs(c, '#8fb8de');
    ellipse(c, 0, -2, 17, 3.5); fs(c, '#b8d4ee', 1.5);
    for (const [x, y] of [[-8, -4], [-1, -6], [6, -4], [0, -2]]) { ellipse(c, x, y, 4, 3); fs(c, '#d49250', 1.2); }
  },
  apple: (c) => {
    c.beginPath(); c.moveTo(0, -9); c.bezierCurveTo(-12, -17, -20, -2, -14, 9); c.bezierCurveTo(-9, 18, -3, 16, 0, 14); c.bezierCurveTo(3, 16, 9, 18, 14, 9); c.bezierCurveTo(20, -2, 12, -17, 0, -9); c.closePath();
    fs(c, '#ef4b4b');
    ellipse(c, -7, -4, 3, 5, 0.4); c.fillStyle = 'rgba(255,255,255,0.6)'; c.fill();
    c.beginPath(); c.moveTo(0, -9); c.lineTo(1, -16); c.stroke();
    c.beginPath(); c.moveTo(1, -14); c.quadraticCurveTo(9, -20, 12, -13); c.quadraticCurveTo(6, -10, 1, -14); fs(c, '#6cc04a', 1.6);
  },
  strawberry: (c) => {
    c.beginPath(); c.moveTo(-14, -6); c.quadraticCurveTo(-14, 10, 0, 17); c.quadraticCurveTo(14, 10, 14, -6); c.quadraticCurveTo(0, -12, -14, -6); c.closePath();
    fs(c, '#ff4d6d');
    c.fillStyle = '#ffe28a';
    for (const [x, y] of [[-7, -1], [0, 0], [7, -1], [-4, 6], [4, 6], [0, 11]]) { ellipse(c, x, y, 1.3, 2); c.fill(); }
    c.beginPath();
    for (let i = 0; i < 5; i++) { const a = Math.PI + (i / 4) * Math.PI; c.lineTo(Math.cos(a) * 11, -8 + Math.sin(a) * 5 * (i % 2 ? 0.4 : 1)); }
    c.closePath(); fs(c, '#5cb85c', 1.5);
  },
  carrot: (c) => {
    c.beginPath(); c.moveTo(-6, -10); c.quadraticCurveTo(-8, 4, 2, 18); c.quadraticCurveTo(10, 2, 7, -10); c.closePath();
    fs(c, '#ff9a3c');
    c.strokeStyle = '#c96a1b'; c.lineWidth = 1.5;
    for (const y of [-3, 4, 10]) { c.beginPath(); c.moveTo(-4, y); c.lineTo(1, y + 1); c.stroke(); }
    for (const a of [-0.5, 0, 0.5]) { c.save(); c.translate(0, -10); c.rotate(a); ellipse(c, 0, -7, 3, 8); fs(c, '#62c152', 1.5); c.restore(); }
  },
  blueberry: (c) => {
    for (const [x, y] of [[-7, 4], [7, 4], [0, -6]]) {
      ellipse(c, x, y, 9, 9); fs(c, '#4a6fd1');
      c.fillStyle = '#2d4494'; starPath(c, x, y - 5, 2.5, 5, 0.5); c.fill();
      ellipse(c, x - 3, y, 2, 2.5); c.fillStyle = 'rgba(255,255,255,0.5)'; c.fill();
    }
  },
  cookie: (c) => {
    starPath(c, 0, 1, 18, 5, 0.6); fs(c, '#e6b35a');
    c.fillStyle = '#7a4a2a';
    for (const [x, y] of [[-4, -2], [4, 3], [0, 7], [5, -5]]) { ellipse(c, x, y, 1.8, 1.8); c.fill(); }
    starPath(c, 0, 1, 9, 5, 0.6); c.fillStyle = 'rgba(255,240,200,0.7)'; c.fill();
  },
  cheese: (c) => {
    c.beginPath(); c.moveTo(-16, 10); c.lineTo(16, 10); c.lineTo(16, -2); c.lineTo(-10, -12); c.closePath();
    fs(c, '#ffd54a');
    c.beginPath(); c.moveTo(-10, -12); c.lineTo(16, -2); c.lineTo(-16, 10); c.stroke();
    c.fillStyle = '#e8b320';
    for (const [x, y, r] of [[2, 3, 3], [10, 5, 2], [-7, 5, 2.2]]) { ellipse(c, x, y, r, r); c.fill(); }
  },
  moonberry: (c) => {
    const g = c.createRadialGradient(-4, -4, 2, 0, 0, 16);
    g.addColorStop(0, '#fff6ff'); g.addColorStop(0.5, '#c79bff'); g.addColorStop(1, '#6a4bd0');
    ellipse(c, 0, 2, 15, 15); fs(c, g);
    c.fillStyle = '#fff8c4'; starPath(c, 4, -1, 5, 5, 0.45); c.fill();
    c.fillStyle = '#fff'; starPath(c, -7, 7, 2.5, 4, 0.4); c.fill();
    c.beginPath(); c.moveTo(0, -12); c.quadraticCurveTo(6, -19, 11, -15); c.stroke();
  },
  ball: (c) => {
    ellipse(c, 0, 0, 16, 16); fs(c, '#ff6b6b');
    c.save(); ellipse(c, 0, 0, 16, 16); c.clip();
    c.strokeStyle = '#fff'; c.lineWidth = 4;
    c.beginPath(); c.arc(-22, 0, 16, -0.9, 0.9); c.stroke();
    c.beginPath(); c.arc(22, 0, 16, Math.PI - 0.9, Math.PI + 0.9); c.stroke();
    c.restore();
    ellipse(c, -6, -7, 4, 3, -0.5); c.fillStyle = 'rgba(255,255,255,0.6)'; c.fill();
  },
  squeaky: (c) => {
    ellipse(c, 0, 0, 17, 15); fs(c, '#f5c083');
    c.beginPath(); c.ellipse(0, -2, 15.5, 12, 0, 0, Math.PI * 2);
    c.fillStyle = '#ff8fbf'; c.fill();
    ellipse(c, 0, -1, 5.5, 4.5); fs(c, '#f5c083', 2);
    const cols = ['#fff', '#7fd3ff', '#ffe066', '#8be38b'];
    for (let i = 0; i < 7; i++) { const a = i * 0.9 + 0.3; c.save(); c.translate(Math.cos(a) * 10, -2 + Math.sin(a) * 7.5); c.rotate(a); c.fillStyle = cols[i % 4]; c.fillRect(-2, -0.8, 4, 1.8); c.restore(); }
    ellipse(c, 0, 0, 17, 15); c.strokeStyle = OL; c.lineWidth = 2.2; c.stroke();
  },
  wand: (c) => {
    c.strokeStyle = '#a0764f'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(-16, 18); c.lineTo(4, -6); c.stroke();
    c.strokeStyle = '#777'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(4, -6); c.quadraticCurveTo(12, -8, 10, 2); c.stroke();
    c.save(); c.translate(10, 4); c.rotate(0.4);
    ellipse(c, 0, 8, 4.5, 11); fs(c, '#ff7fb8', 1.6);
    ellipse(c, -4, 6, 3.5, 9, 0.3); fs(c, '#7fd3ff', 1.6);
    c.restore();
  },
  bubbles: (c) => {
    c.strokeStyle = '#a07ad8'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(-15, 18); c.lineTo(-4, 3); c.stroke();
    ellipse(c, 0, -2, 7, 7); c.strokeStyle = '#a07ad8'; c.lineWidth = 3; c.stroke();
    for (const [x, y, r] of [[8, -12, 6], [14, -2, 4], [3, -18, 3.5]]) {
      ellipse(c, x, y, r, r); c.fillStyle = 'rgba(190,230,255,0.5)'; c.fill(); c.strokeStyle = '#6fb0e0'; c.lineWidth = 1.6; c.stroke();
      ellipse(c, x - r * 0.35, y - r * 0.35, r * 0.25, r * 0.25); c.fillStyle = '#fff'; c.fill();
    }
  },
  heart: (c) => { heartPath(c, 0, 4, 17); fs(c, '#ff5c8a'); ellipse(c, -6, -4, 3, 2, -0.6); c.fillStyle = 'rgba(255,255,255,0.7)'; c.fill(); },
  heartbroken: (c) => { heartPath(c, 0, 4, 17); fs(c, '#ffb3c6'); },
  sparkle: (c) => { starPath(c, 0, 0, 17, 4, 0.3); fs(c, '#ffe066', 1.8, '#c99a10'); },
  twinkle: (c) => {
    starPath(c, 0, 1, 17, 5, 0.5); const g = c.createLinearGradient(0, -17, 0, 17); g.addColorStop(0, '#fff29a'); g.addColorStop(1, '#ffb52e');
    fs(c, g, 2.2, '#b9760a');
    ellipse(c, -4, -3, 2, 2.6); c.fillStyle = '#5a3a10'; c.fill(); ellipse(c, 4, -3, 2, 2.6); c.fill();
    c.beginPath(); c.arc(0, 2, 3.5, 0.2, Math.PI - 0.2); c.strokeStyle = '#5a3a10'; c.lineWidth = 1.6; c.stroke();
  },
  water: (c) => {
    c.beginPath(); c.moveTo(0, -17); c.bezierCurveTo(8, -6, 14, 2, 14, 7); c.arc(0, 7, 14, 0, Math.PI); c.bezierCurveTo(-14, 2, -8, -6, 0, -17); c.closePath();
    fs(c, '#5fb8ff'); ellipse(c, -5, 6, 3, 5, 0.3); c.fillStyle = 'rgba(255,255,255,0.6)'; c.fill();
  },
  bed: (c) => {
    ellipse(c, 0, 6, 19, 10); fs(c, '#6fa8dc'); ellipse(c, 0, 3, 13, 6); fs(c, '#cfe2f3', 1.6);
    c.font = 'bold 12px sans-serif'; c.fillStyle = '#6a7fd6'; c.fillText('z', 6, -8); c.fillText('z', 12, -15);
  },
  outside: (c) => {
    ellipse(c, 0, -5, 15, 13); fs(c, '#6cc04a');
    c.beginPath(); c.rect(-3, 5, 6, 12); fs(c, '#a0764f');
    ellipse(c, -5, -8, 3, 3); c.fillStyle = '#ff7f9c'; c.fill(); ellipse(c, 6, -2, 3, 3); c.fill();
  },
  home: (c) => {
    c.beginPath(); c.moveTo(-16, -1); c.lineTo(0, -16); c.lineTo(16, -1); c.closePath(); fs(c, '#ff8a7a');
    c.beginPath(); c.rect(-12, -2, 24, 18); fs(c, '#fff1d6');
    c.beginPath(); c.rect(-4, 5, 8, 11); fs(c, '#b37a4c', 1.6);
  },
  brush: (c) => {
    c.save(); c.rotate(-0.6);
    roundRect(c, -4, 2, 8, 18, 3); fs(c, '#b8855a');
    roundRect(c, -11, -14, 22, 16, 5); fs(c, '#ff9ec4');
    c.strokeStyle = '#fff'; c.lineWidth = 1.5;
    for (let x = -8; x <= 8; x += 4) { c.beginPath(); c.moveTo(x, -14); c.lineTo(x, -19); c.stroke(); }
    c.restore();
  },
  bath: (c) => {
    c.beginPath(); c.moveTo(-18, -2); c.lineTo(18, -2); c.quadraticCurveTo(17, 14, 0, 14); c.quadraticCurveTo(-17, 14, -18, -2); fs(c, '#9fd8ff');
    for (const [x, y, r] of [[-8, -6, 6], [0, -9, 7], [9, -6, 5.5], [5, -15, 3.5]]) { ellipse(c, x, y, r, r); fs(c, '#fff', 1.5, '#7fb6dd'); }
    c.beginPath(); c.moveTo(-12, 14); c.lineTo(-14, 18); c.moveTo(12, 14); c.lineTo(14, 18); c.stroke();
  },
  soap: (c) => { roundRect(c, -14, -8, 28, 18, 7); fs(c, '#ffb3d9'); ellipse(c, 6, -11, 5, 5); fs(c, '#fff', 1.5, '#7fb6dd'); ellipse(c, -6, -13, 3.5, 3.5); fs(c, '#fff', 1.5, '#7fb6dd'); },
  shower: (c) => {
    c.beginPath(); c.moveTo(-14, -2); c.lineTo(8, -2); c.lineTo(12, -12); c.lineTo(16, -12); c.lineTo(12, 4); c.lineTo(-14, 4); c.closePath(); fs(c, '#7fc8ff');
    c.beginPath(); c.rect(-14, -2, 20, 14); fs(c, '#7fc8ff');
    c.strokeStyle = '#5fb8ff'; c.lineWidth = 2;
    for (const x of [-10, -3, 4]) { c.beginPath(); c.moveTo(x, 15); c.lineTo(x - 2, 20); c.stroke(); }
  },
  towel: (c) => {
    roundRect(c, -15, -12, 30, 24, 4); fs(c, '#ffd166');
    c.strokeStyle = '#ff8a5c'; c.lineWidth = 3; c.beginPath(); c.moveTo(-15, 5); c.lineTo(15, 5); c.moveTo(-15, 9); c.lineTo(15, 9); c.stroke();
  },
  star: (c) => { starPath(c, 0, 1, 17, 5, 0.5); fs(c, '#ffd23f'); },
  starEmpty: (c) => { starPath(c, 0, 1, 17, 5, 0.5); fs(c, '#e8dccc', 2.2, '#b8a894'); },
  book: (c) => {
    roundRect(c, -15, -16, 28, 32, 4); fs(c, '#ff8fab');
    c.beginPath(); c.rect(9, -14, 5, 28); fs(c, '#fff4e6', 1.5);
    heartPath(c, -2, 2, 7); c.fillStyle = '#fff'; c.fill();
  },
  bag: (c) => {
    roundRect(c, -15, -6, 30, 22, 5); fs(c, '#8fd3a8');
    c.beginPath(); c.arc(0, -6, 8, Math.PI, 0); c.strokeStyle = OL; c.lineWidth = 3; c.stroke();
    starPath(c, 0, 5, 6, 5, 0.5); c.fillStyle = '#fff'; c.fill();
  },
  gear: (c) => {
    c.beginPath();
    for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; const r = i % 2 ? 12 : 17; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    c.closePath(); fs(c, '#b8c4d8');
    ellipse(c, 0, 0, 5.5, 5.5); fs(c, '#fff', 2);
  },
  hand: (c) => {
    ellipse(c, 0, 4, 12, 11); fs(c, '#ffd9c0');
    for (const [x, y, a] of [[-10, -6, -0.4], [-4, -11, -0.1], [3, -11, 0.1], [9, -7, 0.35]]) { c.save(); c.translate(x, y); c.rotate(a); ellipse(c, 0, 0, 3.6, 6.5); fs(c, '#ffd9c0', 1.8); c.restore(); }
    c.save(); c.translate(13, 6); c.rotate(0.9); ellipse(c, 0, 0, 3.6, 6.5); fs(c, '#ffd9c0', 1.8); c.restore();
  },
  cuddle: (c) => { ICONS.hand(c); heartPath(c, 10, -10, 8); fs(c, '#ff5c8a', 1.6); },
  play: (c) => { ICONS.ball(c); },
  feed: (c) => { ICONS.apple(c); },
  care: (c) => { c.save(); c.translate(-4, 2); ICONS.brush(c); c.restore(); for (const [x, y, r] of [[11, -12, 5], [15, -3, 3.5]]) { ellipse(c, x, y, r, r); fs(c, 'rgba(200,235,255,0.8)', 1.5, '#6fb0e0'); } },
  tricks: (c) => { starPath(c, 0, 1, 17, 5, 0.5); fs(c, '#ffd23f'); ellipse(c, -4, 0, 1.8, 2.5); c.fillStyle = OL; c.fill(); ellipse(c, 4, 0, 1.8, 2.5); c.fill(); c.beginPath(); c.arc(0, 4, 3, 0.2, Math.PI - 0.2); c.stroke(); },
  close: (c) => { c.strokeStyle = OL; c.lineWidth = 5; c.beginPath(); c.moveTo(-10, -10); c.lineTo(10, 10); c.moveTo(10, -10); c.lineTo(-10, 10); c.stroke(); },
  back: (c) => { c.strokeStyle = OL; c.lineWidth = 5; c.beginPath(); c.moveTo(6, -12); c.lineTo(-6, 0); c.lineTo(6, 12); c.stroke(); },
  paw: (c) => {
    ellipse(c, 0, 6, 10, 8); fs(c, '#ff9fb4');
    for (const [x, y] of [[-10, -5], [-4, -11], [4, -11], [10, -5]]) { ellipse(c, x, y, 4, 5); fs(c, '#ff9fb4', 1.8); }
  },
  trophy: (c) => {
    c.beginPath(); c.moveTo(-12, -15); c.lineTo(12, -15); c.quadraticCurveTo(12, 4, 0, 5); c.quadraticCurveTo(-12, 4, -12, -15); fs(c, '#ffd23f');
    c.beginPath(); c.rect(-3, 5, 6, 6); fs(c, '#e0a820'); c.beginPath(); c.rect(-9, 11, 18, 5); fs(c, '#b07a45');
  },
  sit: (c) => { c.font = 'bold 22px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = OL; c.fillText('⤓', 0, 0); },
  spin: (c) => { c.strokeStyle = '#7f7fff'; c.lineWidth = 4; c.beginPath(); c.arc(0, 0, 12, 0.3, Math.PI * 1.7); c.stroke(); c.beginPath(); c.moveTo(12, -8); c.lineTo(10, 0); c.lineTo(3, -5); c.fillStyle = '#7f7fff'; c.fill(); },
  highfive: (c) => { ICONS.hand(c); },
  rollover: (c) => { c.strokeStyle = '#ff8a5c'; c.lineWidth = 4; c.beginPath(); c.arc(0, 2, 12, Math.PI, 0); c.stroke(); c.beginPath(); c.arc(0, -2, 12, 0, Math.PI); c.strokeStyle = '#5fb8ff'; c.stroke(); },
  treat: (c) => { ICONS.cookie(c); },
  clap: (c) => { heartPath(c, 0, 4, 14); fs(c, '#ffb3c8'); c.font = 'bold 14px system-ui'; c.textAlign = 'center'; c.fillStyle = '#fff'; c.fillText('!', 0, 2); },
  dig: (c) => { ellipse(c, 0, 8, 17, 8); fs(c, '#a0764f'); c.fillStyle = '#7a5530'; for (const [x, y] of [[-6, 6], [5, 9], [0, 4]]) { ellipse(c, x, y, 2.5, 2); c.fill(); } starPath(c, 8, -8, 6, 4, 0.35); fs(c, '#ffe066', 1.4); },
  sniff: (c) => { c.font = '26px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = OL; c.fillText('?', 0, 0); },
  music: (c) => { c.font = 'bold 28px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#ff8ac0'; c.fillText('♫', 0, 0); },
  sound: (c) => { c.beginPath(); c.moveTo(-14, -5); c.lineTo(-7, -5); c.lineTo(2, -13); c.lineTo(2, 13); c.lineTo(-7, 5); c.lineTo(-14, 5); c.closePath(); fs(c, '#7fc8ff'); c.beginPath(); c.arc(4, 0, 9, -0.8, 0.8); c.stroke(); c.beginPath(); c.arc(4, 0, 14, -0.8, 0.8); c.stroke(); },
  camera: (c) => { roundRect(c, -16, -9, 32, 22, 4); fs(c, '#9aa7c8'); ellipse(c, 0, 2, 7, 7); fs(c, '#e8f0ff'); },
};

function drawCollectible(ctx: CanvasRenderingContext2D, id: string) {
  const d = COLLECTIBLES.find((c) => c.id === id);
  if (!d) return;
  const c = ctx, col = d.color;
  switch (d.shape) {
    case 'pebble': ellipse(c, 0, 2, 16, 12, 0.2); fs(c, col); ellipse(c, -5, -3, 4, 2.5, -0.3); c.fillStyle = 'rgba(255,255,255,0.7)'; c.fill(); break;
    case 'acorn': ellipse(c, 0, 5, 11, 12); fs(c, col); c.beginPath(); c.arc(0, -3, 13, Math.PI, 0); c.closePath(); fs(c, '#7a5530'); c.beginPath(); c.moveTo(0, -16); c.lineTo(2, -20); c.stroke(); break;
    case 'leaf': c.beginPath(); c.moveTo(-14, 14); c.quadraticCurveTo(-14, -14, 14, -14); c.quadraticCurveTo(14, 14, -14, 14); fs(c, col); c.beginPath(); c.moveTo(-14, 14); c.lineTo(8, -8); c.stroke(); break;
    case 'button': ellipse(c, 0, 0, 15, 15); fs(c, col); c.fillStyle = shade(col, -0.4); for (const [x, y] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) { ellipse(c, x, y, 2.2, 2.2); c.fill(); } break;
    case 'feather': c.save(); c.rotate(0.6); ellipse(c, 0, 0, 7, 18); fs(c, col); c.beginPath(); c.moveTo(0, -18); c.lineTo(0, 22); c.stroke(); c.restore(); break;
    case 'shell': c.beginPath(); c.moveTo(0, 14); for (let i = 0; i <= 8; i++) { const a = Math.PI + (i / 8) * Math.PI; c.lineTo(Math.cos(a) * 16, 2 + Math.sin(a) * 15); } c.closePath(); fs(c, col); c.strokeStyle = shade(col, -0.3); for (let i = 1; i < 8; i += 2) { const a = Math.PI + (i / 8) * Math.PI; c.beginPath(); c.moveTo(0, 14); c.lineTo(Math.cos(a) * 14, 2 + Math.sin(a) * 13); c.stroke(); } break;
    case 'marble': { const g = c.createRadialGradient(-4, -4, 1, 0, 0, 15); g.addColorStop(0, '#fff'); g.addColorStop(1, col); ellipse(c, 0, 0, 14, 14); fs(c, g); c.strokeStyle = '#3f8f7c'; c.lineWidth = 2; c.beginPath(); c.arc(0, 0, 7, 0.5, 3.5); c.stroke(); break; }
    case 'pinecone': for (let r = 0; r < 4; r++) for (let k = -r; k <= r; k += 2) { ellipse(c, k * 4, -12 + r * 8, 5, 5); fs(c, col, 1.5); } break;
    case 'snail': ellipse(c, 0, 0, 14, 14); fs(c, col); c.strokeStyle = shade(col, -0.35); c.lineWidth = 2; c.beginPath(); for (let i = 0; i < 30; i++) { const a = i * 0.4, r = 12 - i * 0.38; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); } c.stroke(); break;
    case 'clover': for (let i = 0; i < 4; i++) { c.save(); c.rotate((i * Math.PI) / 2); heartPath(c, 0, -8, 9); fs(c, col, 1.6); c.restore(); } break;
    case 'heart': heartPath(c, 0, 4, 16); fs(c, col); ellipse(c, -6, -4, 3, 2, -0.6); c.fillStyle = 'rgba(255,255,255,0.7)'; c.fill(); break;
    case 'key': ellipse(c, -8, 0, 7, 7); fs(c, col); c.beginPath(); c.rect(-2, -2.5, 20, 5); fs(c, col); c.beginPath(); c.rect(12, 2, 3, 6); fs(c, col, 1.5); break;
    case 'crystal': c.beginPath(); c.moveTo(0, -18); c.lineTo(10, -4); c.lineTo(6, 16); c.lineTo(-6, 16); c.lineTo(-10, -4); c.closePath(); fs(c, col); c.beginPath(); c.moveTo(0, -18); c.lineTo(0, 16); c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.stroke(); break;
    case 'star': starPath(c, 0, 1, 17, 5, 0.5); fs(c, col); break;
    case 'rainbow': { const cols = ['#ff7a7a', '#ffc36b', '#fff27a', '#8be38b', '#7ec8ff', '#c49bff']; cols.forEach((cc, i) => { c.beginPath(); c.arc(0, 8, 17 - i * 2.5, Math.PI, 0); c.strokeStyle = cc; c.lineWidth = 3; c.stroke(); }); break; }
  }
}

function drawWearIcon(ctx: CanvasRenderingContext2D, id: string) {
  const w = WEARABLES.find((x) => x.id === id);
  const c = ctx;
  if (!w) return;
  switch (id) {
    case 'bow': c.fillStyle = w.color; c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(-18, -16, -20, 0); c.quadraticCurveTo(-18, 14, 0, 0); fs(c, w.color); c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(18, -16, 20, 0); c.quadraticCurveTo(18, 14, 0, 0); fs(c, w.color); ellipse(c, 0, 0, 5, 5); fs(c, '#e04468'); break;
    case 'partyhat': c.beginPath(); c.moveTo(-13, 15); c.lineTo(0, -16); c.lineTo(13, 15); c.closePath(); fs(c, w.color); ellipse(c, 0, -17, 5, 5); fs(c, '#ff6b8b'); break;
    case 'beanie': c.beginPath(); c.arc(0, 8, 16, Math.PI, 0); c.closePath(); fs(c, w.color); c.beginPath(); c.rect(-17, 6, 34, 8); fs(c, '#f08a24'); ellipse(c, 0, -10, 6, 6); fs(c, '#fff3e0'); break;
    case 'flowers': ['#ff8ab5', '#ffe066', '#9fd8ff'].forEach((cc, i) => { const x = -12 + i * 12; for (let k = 0; k < 5; k++) { const b = (k / 5) * Math.PI * 2; ellipse(c, x + Math.cos(b) * 5, Math.sin(b) * 5, 4.5, 4.5); c.fillStyle = cc; c.fill(); } ellipse(c, x, 0, 3, 3); c.fillStyle = '#fff6b0'; c.fill(); }); break;
    case 'crown': c.beginPath(); c.moveTo(-15, 12); c.lineTo(-17, -10); c.lineTo(-7, -2); c.lineTo(0, -14); c.lineTo(7, -2); c.lineTo(17, -10); c.lineTo(15, 12); c.closePath(); fs(c, w.color); ellipse(c, 0, 3, 3.5, 3.5); c.fillStyle = '#ff4f7b'; c.fill(); break;
    case 'glasses': c.strokeStyle = w.color; c.lineWidth = 3; ellipse(c, -9, 0, 8, 8); c.stroke(); ellipse(c, 9, 0, 8, 8); c.stroke(); c.beginPath(); c.moveTo(-1, 0); c.lineTo(1, 0); c.stroke(); break;
    case 'stars': starPath(c, -9, 0, 10, 5, 0.55); fs(c, '#ff8ad8'); starPath(c, 9, 0, 10, 5, 0.55); fs(c, '#ff8ad8'); break;
    case 'bandana': c.beginPath(); c.moveTo(-17, -8); c.lineTo(17, -8); c.lineTo(0, 14); c.closePath(); fs(c, w.color); break;
    case 'collar': c.beginPath(); c.arc(0, -6, 15, 0.3, Math.PI - 0.3); c.strokeStyle = OL; c.lineWidth = 8; c.stroke(); c.strokeStyle = w.color; c.lineWidth = 5; c.stroke(); ellipse(c, 0, 11, 5, 5); fs(c, '#ffd23f'); break;
    case 'scarf': c.beginPath(); c.arc(0, -8, 15, 0.2, Math.PI - 0.2); c.strokeStyle = OL; c.lineWidth = 10; c.stroke(); c.strokeStyle = w.color; c.lineWidth = 7; c.stroke(); c.beginPath(); c.rect(-10, 2, 7, 15); fs(c, w.color); break;
  }
}

function drawDecorIcon(ctx: CanvasRenderingContext2D, id: string) {
  const d = DECOR.find((x) => x.id === id);
  if (!d) return;
  const c = ctx, [a, b] = d.colors;
  switch (d.slot) {
    case 'bed': ellipse(c, 0, 6, 19, 10); fs(c, a); ellipse(c, 0, 3, 12, 5.5); fs(c, b, 1.6); if (id === 'bed_donut') { c.fillStyle = '#fff'; for (let i = 0; i < 6; i++) c.fillRect(-14 + i * 5, 2 + (i % 2) * 6, 3, 1.5); } break;
    case 'rug': ellipse(c, 0, 4, 19, 11); fs(c, a); d.colors.slice(1).forEach((cc, i) => { ellipse(c, 0, 4, 15 - i * 3.5, 8 - i * 2); c.fillStyle = cc; c.fill(); }); if (id === 'rug_star') { starPath(c, 0, 4, 5, 5, 0.5); c.fillStyle = b; c.fill(); } break;
    case 'bowls': for (const x of [-9, 9]) { c.beginPath(); c.moveTo(x - 9, 0); c.quadraticCurveTo(x - 8, 10, x, 10); c.quadraticCurveTo(x + 8, 10, x + 9, 0); c.closePath(); fs(c, x < 0 ? a : b); } break;
    case 'wall': roundRect(c, -15, -15, 30, 30, 2); fs(c, '#c08a4a'); c.beginPath(); c.rect(-11, -11, 22, 22); fs(c, a, 1.5); if (id === 'wall_heart') { heartPath(c, 0, 3, 8); c.fillStyle = b; c.fill(); } else if (id === 'wall_sun') { ellipse(c, 0, 0, 6, 6); c.fillStyle = b; c.fill(); } else if (id === 'wall_hills') { ellipse(c, 0, 12, 14, 9); c.fillStyle = b; c.fill(); } else { ICONS.paw(c); } break;
    case 'curtains': c.beginPath(); c.rect(-15, -15, 30, 30); fs(c, '#bfe3ff'); c.beginPath(); c.moveTo(-16, -16); c.lineTo(-4, -16); c.quadraticCurveTo(-8, 2, -12, 16); c.lineTo(-16, 16); c.closePath(); fs(c, a); c.beginPath(); c.moveTo(16, -16); c.lineTo(4, -16); c.quadraticCurveTo(8, 2, 12, 16); c.lineTo(16, 16); c.closePath(); fs(c, a); break;
    case 'basket': roundRect(c, -17, -4, 34, 20, 4); fs(c, a); c.strokeStyle = b; c.lineWidth = 2; for (let y = 0; y < 16; y += 5) { c.beginPath(); c.moveTo(-15, y); c.lineTo(15, y); c.stroke(); } ellipse(c, -5, -6, 6, 6); fs(c, '#ff6b6b', 1.5); break;
    case 'garden':
      if (id === 'garden_birdbath') { c.beginPath(); c.rect(-3, -2, 6, 16); fs(c, a); ellipse(c, 0, -4, 16, 5); fs(c, a); ellipse(c, 0, -5, 12, 3); c.fillStyle = b; c.fill(); }
      else if (id === 'garden_mushroom') { c.beginPath(); c.rect(-9, -2, 18, 16); fs(c, b); c.beginPath(); c.arc(0, -2, 17, Math.PI, 0); c.closePath(); fs(c, a); c.fillStyle = '#fff'; ellipse(c, -7, -9, 3, 3); c.fill(); ellipse(c, 6, -11, 3.5, 3.5); c.fill(); }
      else if (id === 'garden_pinwheels') { d.colors.forEach((cc, i) => { c.save(); c.translate(-10 + i * 10, -4 + (i % 2) * 6); for (let k = 0; k < 4; k++) { c.rotate(Math.PI / 2); c.beginPath(); c.moveTo(0, 0); c.lineTo(8, -3); c.lineTo(3, 3); c.closePath(); fs(c, cc, 1); } c.restore(); }); }
      else { ellipse(c, 0, 6, 16, 7); fs(c, '#7cc36a'); }
      break;
  }
}

const urlCache = new Map<string, string>();
/** Render an icon to a data URL for DOM <img> use. */
export function iconURL(id: string, px = 96): string {
  const key = id + '@' + px;
  const hit = urlCache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = cv.height = px;
  const ctx = cv.getContext('2d')!;
  ctx.translate(px / 2, px / 2);
  drawIcon(ctx, id, px * 0.82);
  const url = cv.toDataURL();
  urlCache.set(key, url);
  return url;
}
