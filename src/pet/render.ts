// Procedural pet renderer. Draws the pet in local space (origin = ground under the pet,
// +x = the direction it faces) from a set of continuous pose parameters.
import { PALETTES, Palette } from '../data';
import type { Appearance } from '../state';
import { lerp, shade, ellipse, heartPath, starPath, clamp01 } from '../util';

export interface Pose {
  crouch: number; sit: number; lie: number; belly: number; bow: number;
  front: number; headFront: number;
  squash: number; hop: number; tilt: number;
  headTilt: number; headDown: number;
  walk: number; walkPhase: number; breath: number;
  eyeOpen: number; eyeHappy: number; eyeWide: number; pupil: number; lookX: number; lookY: number;
  brow: number; mouthOpen: number; smile: number; tongue: number; blush: number; cheekPuff: number;
  earPerk: number; earSwingN: number; earSwingF: number;
  tailWag: number; tailPhase: number; tailUp: number;
  paw: number; shake: number; kick: number; wet: number; dirt: number; foam: number; floof: number;
  special: number; // 0 none, 1 heart, 2 spiral, 3 star, 4 sleep-closed
  sniff: number; time: number;
}

export function defaultPose(): Pose {
  return {
    crouch: 0, sit: 0, lie: 0, belly: 0, bow: 0, front: 0, headFront: 0,
    squash: 0, hop: 0, tilt: 0, headTilt: 0, headDown: 0,
    walk: 0, walkPhase: 0, breath: 0,
    eyeOpen: 1, eyeHappy: 0, eyeWide: 0, pupil: 1, lookX: 0, lookY: 0,
    brow: 0, mouthOpen: 0, smile: 0.4, tongue: 0, blush: 0.3, cheekPuff: 0,
    earPerk: 0, earSwingN: 0, earSwingF: 0,
    tailWag: 0.3, tailPhase: 0, tailUp: 0.5,
    paw: 0, shake: 0, kick: 0, wet: 0, dirt: 0, foam: 0, floof: 0,
    special: 0, sniff: 0, time: 0,
  };
}

interface BodyPreset { bw: number; bh: number; leg: number; legW: number; R: number; fluff: number; }
const BODIES: Record<string, BodyPreset> = {
  round: { bw: 56, bh: 44, leg: 15, legW: 17, R: 54, fluff: 0 },
  sleek: { bw: 62, bh: 38, leg: 24, legW: 14, R: 50, fluff: 0 },
  fluffy: { bw: 58, bh: 46, leg: 13, legW: 17, R: 56, fluff: 1 },
};

/** Geometry of the last draw, in pet-local units, for hit testing. */
export interface Rig {
  hx: number; hy: number; R: number; hrot: number;
  bx: number; by: number; brx: number; bry: number; brot: number;
  earN: [number, number]; earF: [number, number];
  tailX: number; tailY: number;
  noseX: number; noseY: number;
  mouthX: number; mouthY: number;
  upside: boolean;
  top: number;
}
export const newRig = (): Rig => ({ hx: 0, hy: -100, R: 50, hrot: 0, bx: 0, by: -50, brx: 50, bry: 40, brot: 0, earN: [0, 0], earF: [0, 0], tailX: 0, tailY: 0, noseX: 0, noseY: 0, mouthX: 0, mouthY: 0, upside: false, top: -160 });

export interface Wear { head?: string; face?: string; neck?: string; }

let OUT = 3.2;

function blob(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, rot: number, bumps: number, amp: number, phase = 0) {
  if (amp <= 0.001) { ellipse(ctx, cx, cy, rx, ry, rot); return; }
  ctx.beginPath();
  const n = bumps * 2;
  const c = Math.cos(rot), s = Math.sin(rot);
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2 + phase;
    const r = i % 2 === 0 ? 1 + amp : 1 - amp * 0.3;
    const lx = Math.cos(a) * rx * r, ly = Math.sin(a) * ry * r;
    const px = cx + lx * c - ly * s, py = cy + lx * s + ly * c;
    if (i === 0) ctx.moveTo(px, py);
    else {
      const am = ((i - 0.5) / n) * Math.PI * 2 + phase;
      const mr = 1 + amp * 0.9;
      const mx = Math.cos(am) * rx * mr, my = Math.sin(am) * ry * mr;
      ctx.quadraticCurveTo(cx + mx * c - my * s, cy + mx * s + my * c, px, py);
    }
  }
  ctx.closePath();
}

function fillStroke(ctx: CanvasRenderingContext2D, fill: string | CanvasGradient, stroke: string) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = OUT;
  ctx.stroke();
}

function rot(x: number, y: number, a: number): [number, number] {
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
}

export function drawPet(ctx: CanvasRenderingContext2D, p: Pose, ap: Appearance, wear: Wear, rig: Rig, growth = 1) {
  const pal: Palette = PALETTES[ap.palette] ?? PALETTES[0];
  const B = BODIES[ap.body] ?? BODIES.round;
  const main = p.wet > 0.05 ? shade(pal.main, -0.18 * p.wet) : pal.main;
  const line = shade(pal.main, pal.main === '#4b4f6b' ? -0.55 : -0.5);
  const dark = pal.dark;
  const bellyC = pal.belly;
  OUT = 3.2;
  ctx.save();
  ctx.scale(growth, growth);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const f = clamp01(p.front);
  const hf = clamp01(Math.max(p.headFront, f));
  const upside = p.belly > 0.5;
  const flip = Math.max(0.2, Math.abs(Math.cos(p.belly * Math.PI)));
  const fluffAmp = (B.fluff * 0.07 + p.floof * 0.12) * (1 - p.wet * 0.8) + p.wet * 0.03;
  const bw = B.bw, bh = B.bh, R = B.R;
  const t = p.time;

  // ---------- body placement ----------
  const lieAmt = upside ? 1 : p.lie;
  const standY = -(B.leg + bh);
  const lieY = -bh * 0.8;
  const bob = -Math.abs(Math.sin(p.walkPhase)) * 3 * p.walk;
  let bcy = lerp(standY, lieY, lieAmt) + p.crouch * B.leg * 0.9 + p.sit * bh * 0.25 * (1 - lieAmt) + bob - p.hop;
  let bcx = -p.sit * bw * 0.15 * (1 - f);
  const sitRot = -0.42 * p.sit * (1 - f) * (1 - lieAmt);
  let brot = sitRot + 0.4 * p.bow * (1 - lieAmt) + p.tilt;
  if (p.shake > 0.01) brot += Math.sin(t * 38) * 0.22 * p.shake;
  const breath = 1 + Math.sin(p.breath) * 0.025;
  let brx = lerp(bw, bw * 0.8, f) * (1 + p.squash * 0.3);
  let bry = bh * (1 - p.squash * 0.28) * breath * (1 + p.sit * f * 0.14);
  if (upside) { bry *= flip; } else if (p.belly > 0.01) { bry *= flip; }
  if (p.sit > 0 && f > 0) bcy -= p.sit * f * bh * 0.1;

  const toL = (x: number, y: number): [number, number] => {
    const [rx, ry] = rot(x, y, brot);
    return [bcx + rx, bcy + ry];
  };

  rig.bx = bcx; rig.by = bcy; rig.brx = brx; rig.bry = bry; rig.brot = brot; rig.upside = upside;

  // ---------- head placement ----------
  let hx: number, hy: number;
  if (upside) {
    hx = bw * 0.95; hy = -R * 0.82;
  } else {
    const [sx, sy] = rot(bw * 0.58, -bh * 0.78, brot * 0.55);
    const side: [number, number] = [bcx + sx, bcy + sy - p.sit * 8];
    const frontP: [number, number] = [bcx, bcy - bh * 0.85 - R * 0.42];
    hx = lerp(side[0], frontP[0], f);
    hy = lerp(side[1], frontP[1], f);
    hx += p.headDown * R * 0.35 * (1 - f);
    hy += p.headDown * R * 0.62;
    hy += lieAmt * R * 0.1;
    if (p.shake > 0.01) hx += Math.sin(t * 38 + 1) * 6 * p.shake;
  }
  const minHY = -R * (0.72 + 0.2 * (1 - p.headDown));
  if (hy > minHY) hy = minHY;
  let hrot = p.headTilt + brot * 0.25 + (upside ? -0.55 : 0);
  if (p.shake > 0.01) hrot += Math.sin(t * 38 + 2) * 0.35 * p.shake;
  rig.hx = hx; rig.hy = hy; rig.R = R; rig.hrot = hrot;

  // ---------- tail ----------
  drawTail(ctx, p, ap, pal, main, line, dark, toL, f, upside, bw, bh, R, rig);

  // ---------- legs ----------
  const legs = computeLegs(p, B, toL, f, upside, lieAmt, bcx, bcy, bh, bw);
  const farC = shade(main, -0.12);
  const pawC = ap.marking === 'socks' || ap.marking === 'tips' ? dark : main;
  const farPaw = shade(pawC, -0.12);
  const frontView = f > 0.5 && !upside;
  // far legs (in front view: nothing is behind except the tail)
  if (!frontView) for (const lg of legs) if (lg.far) drawLeg(ctx, lg, farC, farPaw, line, B.legW);
  // far haunch
  if (p.sit > 0.05 && !upside && !frontView) {
    const hxF = lerp(-bw * 0.35, -bw * 0.62, f), hyF = bh * 0.3;
    const [x, y] = toL(hxF, hyF);
    ellipse(ctx, x, Math.min(y, -bh * 0.42 * p.sit), bh * 0.5 * p.sit, bh * 0.42 * p.sit, 0);
    fillStroke(ctx, farC, line);
  }

  // ---------- body ----------
  blob(ctx, bcx, bcy, brx, bry, brot, 9, fluffAmp, 0.3);
  const grad = ctx.createLinearGradient(0, bcy - bry, 0, bcy + bry);
  grad.addColorStop(0, shade(main, 0.08));
  grad.addColorStop(1, shade(main, -0.1));
  fillStroke(ctx, grad, line);
  // belly patch & markings (clipped)
  ctx.save();
  blob(ctx, bcx, bcy, brx, bry, brot, 9, fluffAmp, 0.3);
  ctx.clip();
  if (upside) {
    ellipse(ctx, bcx, bcy - bry * 0.35, brx * 0.72, bry * 0.7, brot);
  } else {
    const [bx2, by2] = toL(lerp(bw * 0.25, 0, f), bh * lerp(0.55, 0.35, f));
    ellipse(ctx, bx2, by2, brx * lerp(0.6, 0.55, f), bry * lerp(0.55, 0.7, f), brot);
  }
  ctx.fillStyle = bellyC;
  ctx.fill();
  if (ap.marking === 'spots') {
    ctx.fillStyle = dark;
    ctx.globalAlpha = 0.75;
    const sp: [number, number, number][] = [[-0.45, -0.35, 0.22], [0.05, -0.55, 0.16], [-0.1, 0.1, 0.13]];
    for (const [sx, sy, sr] of sp) {
      const [x, y] = toL(sx * bw * (upside ? 1 : 1), sy * bh * (upside ? -1 : 1));
      ellipse(ctx, x, y, bw * sr, bw * sr * 0.85, 0);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  if (p.dirt > 0.05) drawDirt(ctx, bcx, bcy, brx, bry, p.dirt);
  ctx.restore();

  // haunches (sitting)
  if (p.sit > 0.05 && !upside) {
    const sides = frontView ? [-1, 1] : [1];
    for (const sd of sides) {
      const hxN = frontView ? sd * bw * 0.6 : lerp(-bw * 0.45, bw * 0.62, f), hyN = bh * 0.32;
      const [x, y] = toL(hxN, hyN);
      const k = frontView ? 0.46 : 0.55;
      blob(ctx, x, Math.min(y, -bh * 0.42 * p.sit), bh * k * p.sit, bh * k * 0.84 * p.sit, frontView ? sd * 0.3 : -0.2 * (1 - f), 5, fluffAmp);
      fillStroke(ctx, main, line);
    }
  }
  if (frontView) {
    for (const i of [3, 2, 1, 0]) drawLeg(ctx, legs[i], i === 1 || i === 3 ? shade(main, -0.04) : main, pawC, line, B.legW, p.paw > 0.4 && legs[i].raised);
  } else for (const lg of legs) if (!lg.far) drawLeg(ctx, lg, main, pawC, line, B.legW, p.paw > 0.4 && lg.raised);

  // ---------- neck accessory back part ----------
  // ---------- head ----------
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(hrot);
  drawHead(ctx, p, ap, pal, main, line, dark, R, hf, fluffAmp, wear, rig);
  ctx.restore();

  // overlays: foam & drips
  if (p.foam > 0.02) drawFoam(ctx, p.foam, bcx, bcy, brx, bry, hx, hy, R, t);
  if (p.wet > 0.2) {
    ctx.fillStyle = 'rgba(120,190,255,0.8)';
    for (let i = 0; i < 4; i++) {
      const ph = (t * 0.8 + i * 0.37) % 1;
      const x = bcx + (i - 1.5) * brx * 0.45;
      const y = bcy + bry * 0.7 + ph * 30;
      ctx.globalAlpha = (1 - ph) * p.wet;
      ellipse(ctx, x, y, 2.5, 4, 0);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  rig.top = hy - R * 1.2;
  ctx.restore();
  // scale rig by growth for hit testing
  if (growth !== 1) {
    rig.hx *= growth; rig.hy *= growth; rig.R *= growth; rig.bx *= growth; rig.by *= growth; rig.brx *= growth; rig.bry *= growth;
    rig.earN[0] *= growth; rig.earN[1] *= growth; rig.earF[0] *= growth; rig.earF[1] *= growth;
    rig.tailX *= growth; rig.tailY *= growth; rig.noseX *= growth; rig.noseY *= growth; rig.mouthX *= growth; rig.mouthY *= growth; rig.top *= growth;
  }
}

interface Leg { hx: number; hy: number; fx: number; fy: number; far: boolean; raised: boolean; show: number; }
const LEGS: Leg[] = [0, 1, 2, 3].map(() => ({ hx: 0, hy: 0, fx: 0, fy: 0, far: false, raised: false, show: 1 }));

function computeLegs(p: Pose, B: BodyPreset, toL: (x: number, y: number) => [number, number], f: number, upside: boolean, lieAmt: number, bcx: number, bcy: number, bh: number, bw: number): Leg[] {
  const stride = 14, lift = 9;
  // 0 front-near, 1 front-far, 2 back-near, 3 back-far
  const cfg = [
    { sx: 0.5, fx: 0.3, far: false, ph: 0, front: true },
    { sx: 0.42, fx: -0.3, far: true, ph: Math.PI, front: true },
    { sx: -0.5, fx: 0.62, far: false, ph: Math.PI, front: false },
    { sx: -0.58, fx: -0.62, far: true, ph: 0, front: false },
  ];
  for (let i = 0; i < 4; i++) {
    const c = cfg[i];
    const L = LEGS[i];
    L.far = c.far;
    L.raised = false;
    L.show = 1;
    if (upside) {
      const hxl = c.sx * bw * 0.9;
      const [hx, hy] = [bcx + hxl, bcy - bh * 0.45];
      const wig = Math.sin(p.time * 7 + i * 1.7) * 5;
      L.hx = hx; L.hy = hy;
      L.fx = hx + (c.front ? 8 : -6) + wig;
      L.fy = hy - 24 - (c.far ? -4 : 0) + Math.cos(p.time * 6 + i) * 3;
      continue;
    }
    const lx = lerp(c.sx * bw, c.fx * bw * (c.front ? 1 : 1), f);
    const hyLocal = bh * 0.55;
    let [hx, hy] = toL(lx, hyLocal);
    // walk cycle
    const phase = p.walkPhase + c.ph;
    let fx = hx + Math.sin(phase) * stride * p.walk;
    let fy = -Math.max(0, Math.cos(phase)) * lift * p.walk;
    // front view spreads the feet slightly
    if (c.front) {
      // front legs stay under chest when sitting
      fx = lerp(fx, hx + 3, p.sit);
    } else {
      // sitting: back feet tuck forward under haunch
      const sitFoot = lerp(hx + bw * 0.42, c.far ? -bw * 0.62 : bw * 0.62, f);
      fx = lerp(fx, sitFoot, p.sit);
      hy = lerp(hy, Math.max(hy, -8), p.sit * 0.7);
    }
    // lie: legs fold under; front paws poke forward
    if (lieAmt > 0) {
      if (c.front) {
        fx = lerp(fx, bcx + bw * lerp(0.95, 0.3, f) + (c.far ? -12 : 0) * (1 - f) + (c.far ? -bw * 0.5 : 0) * f, lieAmt);
        fy = lerp(fy, -3, lieAmt);
        hx = lerp(hx, fx - 14, lieAmt);
        hy = lerp(hy, -10, lieAmt);
      } else {
        fx = lerp(fx, hx + 10, lieAmt);
        fy = lerp(fy, -4, lieAmt);
        hy = lerp(hy, -8, lieAmt);
      }
    }
    // bow: front paws stretch forward
    if (c.front && p.bow > 0) fx += p.bow * 16;
    // crouch: feet spread a bit
    fx += (c.front ? 1 : -1) * p.crouch * 5;
    // kick (happy leg thump) on back near leg
    if (i === 2 && p.kick > 0.01) fy -= Math.abs(Math.sin(p.time * 26)) * 16 * p.kick;
    // raised paw (high five / wave)
    if (i === 0 && p.paw > 0.01) {
      const rx = lerp(hx + bw * 0.45, bw * 0.55, f), ry = lerp(hy - bh * 1.25, bcy - bh * 1.2, f);
      fx = lerp(fx, rx, p.paw); fy = lerp(fy, ry, p.paw);
      L.raised = true;
    }
    L.hx = hx; L.hy = hy; L.fx = fx; L.fy = fy;
  }
  return LEGS;
}

function drawLeg(ctx: CanvasRenderingContext2D, L: Leg, col: string, paw: string, line: string, w: number, beans = false) {
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(L.hx, L.hy);
  ctx.lineTo(L.fx, L.fy - 3);
  ctx.strokeStyle = line;
  ctx.lineWidth = w + OUT * 2;
  ctx.stroke();
  ctx.strokeStyle = col;
  ctx.lineWidth = w;
  ctx.stroke();
  ellipse(ctx, L.fx + 2, L.fy - 4, w * 0.72, w * 0.5, 0);
  fillStroke(ctx, paw, line);
  if (beans) {
    ctx.fillStyle = '#ff9fb4';
    ellipse(ctx, L.fx + 2, L.fy - 3, w * 0.32, w * 0.24, 0); ctx.fill();
    for (let k = -1; k <= 1; k++) { ellipse(ctx, L.fx + 2 + k * w * 0.32, L.fy - 4 - w * 0.33, w * 0.12, w * 0.1, 0); ctx.fill(); }
  }
}

function drawTail(ctx: CanvasRenderingContext2D, p: Pose, ap: Appearance, pal: Palette, main: string, line: string, dark: string,
  toL: (x: number, y: number) => [number, number], f: number, upside: boolean, bw: number, bh: number, R: number, rig: Rig) {
  let [bx, by] = upside ? [rig.bx - bw * 0.95, -8] : toL(lerp(-bw * 0.9, -bw * 0.62, f), lerp(-bh * 0.1, -bh * 0.35, f));
  const wag = p.tailWag;
  const wagS = Math.sin(p.tailPhase);
  let base = Math.PI + lerp(0.15, 1.25, p.tailUp) + (upside ? -0.9 : 0);
  if (f > 0.5) base += 0.25;
  const tipCol = ap.marking === 'tips' ? dark : pal.belly;
  if (ap.tail === 'pom') {
    const ox = bx - 6 + wagS * wag * 4, oy = by - 4 - Math.abs(wagS) * wag * 3;
    blob(ctx, ox, oy, R * 0.3, R * 0.28, 0, 7, 0.12);
    fillStroke(ctx, tipCol === dark ? dark : pal.belly, line);
    rig.tailX = ox; rig.tailY = oy;
    return;
  }
  if (ap.tail === 'curly') {
    const a0 = base + wagS * wag * 0.4;
    const cx = bx + Math.cos(a0) * R * 0.28, cy = by + Math.sin(a0) * R * 0.28;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.2, a0 + Math.PI, a0 + Math.PI + 4.6, false);
    ctx.strokeStyle = line; ctx.lineWidth = R * 0.2 + OUT * 2; ctx.stroke();
    ctx.strokeStyle = main; ctx.lineWidth = R * 0.2; ctx.stroke();
    rig.tailX = cx; rig.tailY = cy;
    return;
  }
  const n = 7;
  const len = ap.tail === 'thin' ? R * 1.25 : R * 1.35;
  const seg = len / n;
  const pts: [number, number][] = [[bx, by]];
  let x = bx, y = by;
  const curl = ap.tail === 'fluffy' ? 0.1 : 0.14;
  for (let i = 1; i <= n; i++) {
    const a = base - curl * i + wag * Math.sin(p.tailPhase - i * 0.55) * 0.12 * (i + 1) * 0.6;
    x += Math.cos(a) * seg; y += Math.sin(a) * seg;
    if (y > -4) y = -4;
    pts.push([x, y]);
  }
  rig.tailX = pts[n - 1][0]; rig.tailY = pts[n - 1][1];
  if (ap.tail === 'thin') {
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.strokeStyle = line; ctx.lineWidth = R * 0.13 + OUT * 2; ctx.stroke();
    ctx.strokeStyle = main; ctx.lineWidth = R * 0.13; ctx.stroke();
    const [tx, ty] = pts[n];
    blob(ctx, tx, ty, R * 0.2, R * 0.2, p.tailPhase * 0.2, 6, 0.18);
    fillStroke(ctx, tipCol, line);
    return;
  }
  // fluffy tail polygon
  const widths = (i: number) => R * (0.14 + 0.24 * Math.sin((i / n) * Math.PI * 0.95 + 0.15));
  const left: [number, number][] = [], right: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const [px, py] = pts[i];
    const [qx, qy] = pts[Math.min(n, i + 1)];
    const [ox, oy] = pts[Math.max(0, i - 1)];
    let dx = qx - ox, dy = qy - oy;
    const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const w = i === n ? 0.5 : widths(i);
    left.push([px - dy * w, py + dx * w]);
    right.push([px + dy * w, py - dx * w]);
  }
  const path = (from: number) => {
    ctx.beginPath();
    ctx.moveTo(left[from][0], left[from][1]);
    for (let i = from + 1; i <= n; i++) {
      const mx = (left[i - 1][0] + left[i][0]) / 2, my = (left[i - 1][1] + left[i][1]) / 2;
      ctx.quadraticCurveTo(left[i - 1][0], left[i - 1][1], mx, my);
    }
    ctx.quadraticCurveTo(pts[n][0] + (pts[n][0] - pts[n - 1][0]) * 0.8, pts[n][1] + (pts[n][1] - pts[n - 1][1]) * 0.8, right[n][0], right[n][1]);
    for (let i = n - 1; i >= from; i--) {
      const mx = (right[i + 1][0] + right[i][0]) / 2, my = (right[i + 1][1] + right[i][1]) / 2;
      ctx.quadraticCurveTo(right[i + 1][0], right[i + 1][1], mx, my);
    }
    ctx.closePath();
  };
  path(0);
  fillStroke(ctx, main, line);
  path(5);
  ctx.fillStyle = tipCol;
  ctx.fill();
  ctx.strokeStyle = line; ctx.lineWidth = OUT; ctx.stroke();
}

function drawEar(ctx: CanvasRenderingContext2D, type: string, main: string, inner: string, tip: string | null, line: string, R: number, sleepy: number) {
  if (type === 'pointy') {
    const w = R * 0.62, h = R * 0.74;
    ctx.beginPath();
    ctx.moveTo(-w / 2, 4);
    ctx.quadraticCurveTo(-w * 0.35, -h * 0.55, -w * 0.02, -h);
    ctx.quadraticCurveTo(w * 0.12, -h * 0.98, w / 2, 4);
    ctx.closePath();
    fillStroke(ctx, main, line);
    if (tip) {
      ctx.save(); ctx.clip();
      ctx.fillStyle = tip; ctx.fillRect(-w, -h * 1.1, w * 2, h * 0.38);
      ctx.restore();
    }
    ctx.beginPath();
    ctx.moveTo(-w * 0.28, 0);
    ctx.quadraticCurveTo(-w * 0.18, -h * 0.5, -w * 0.02, -h * 0.72);
    ctx.quadraticCurveTo(w * 0.1, -h * 0.5, w * 0.28, 0);
    ctx.closePath();
    ctx.fillStyle = inner; ctx.fill();
  } else if (type === 'long') {
    const w = R * 0.34, h = R * 1.05;
    ctx.save();
    ctx.translate(0, 0);
    ctx.rotate(sleepy * 0.9);
    ellipse(ctx, 0, -h * 0.5, w, h * 0.55, 0);
    fillStroke(ctx, main, line);
    if (tip) { ctx.save(); ctx.clip(); ctx.fillStyle = tip; ctx.fillRect(-w * 2, -h * 1.2, w * 4, h * 0.35); ctx.restore(); }
    ellipse(ctx, 0, -h * 0.5, w * 0.48, h * 0.4, 0);
    ctx.fillStyle = inner; ctx.fill();
    ctx.restore();
  } else if (type === 'round') {
    const r = R * 0.3;
    ellipse(ctx, 0, -r * 0.6, r, r, 0);
    fillStroke(ctx, tip ?? main, line);
    ellipse(ctx, 0, -r * 0.5, r * 0.55, r * 0.55, 0);
    ctx.fillStyle = inner; ctx.fill();
  } else {
    // floppy: hangs down from attach point
    const w = R * 0.4, h = R * 0.95;
    ctx.beginPath();
    ctx.moveTo(-w * 0.4, -6);
    ctx.bezierCurveTo(-w * 1.1, h * 0.25, -w * 0.7, h * 0.95, 0, h);
    ctx.bezierCurveTo(w * 0.8, h * 0.95, w * 0.9, h * 0.2, w * 0.4, -6);
    ctx.closePath();
    fillStroke(ctx, tip ?? shade(main, -0.08), line);
  }
}

function drawHead(ctx: CanvasRenderingContext2D, p: Pose, ap: Appearance, pal: Palette, main: string, line: string, dark: string,
  R: number, hf: number, fluffAmp: number, wear: Wear, rig: Rig) {
  const floppy = ap.ears === 'floppy';
  const earTip = ap.marking === 'tips' ? dark : null;
  const perk = p.earPerk;
  // ear attach angles
  let aN: number, aF: number;
  if (floppy) { aN = lerp(-0.2, 1.15, hf); aF = -lerp(0.95, 1.15, hf); }
  else if (ap.ears === 'round') { aN = lerp(0.55, 0.78, hf); aF = -lerp(0.55, 0.78, hf); }
  else if (ap.ears === 'long') { aN = lerp(0.22, 0.32, hf); aF = -lerp(0.35, 0.32, hf); }
  else { aN = lerp(0.42, 0.6, hf); aF = -lerp(0.52, 0.6, hf); }
  const faceX = lerp(R * 0.3, 0, hf);
  const earPos = (a: number): [number, number] => [Math.sin(a) * R * 0.82 + faceX * 0.25, -Math.cos(a) * R * 0.82];
  const sleepy = clamp01(1 - p.eyeOpen) * 0.3 + (perk < 0 ? -perk * 0.3 : 0);
  const earRot = (a: number, swing: number, side: number) => {
    if (floppy) return (side > 0 ? lerp(0.05, -0.28, hf) : lerp(-0.3, 0.28, hf)) + swing * 0.6 - side * perk * 0.25;
    return a * 0.85 + swing * 0.35 - side * perk * -0.1 + side * (perk < 0 ? -perk * 0.7 : 0) - side * (perk > 0 ? perk * 0.12 : 0);
  };
  const [enx, eny] = earPos(aN), [efx, efy] = earPos(aF);
  const inner = pal.inner;
  const drawE = (x: number, y: number, r: number, side: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(r);
    drawEar(ctx, ap.ears, main, inner, earTip, line, R, sleepy * side);
    ctx.restore();
  };
  const rN = earRot(aN, p.earSwingN, 1), rF = earRot(aF, p.earSwingF, -1);
  // record ear tips for hit tests (approx.)
  const earLen = floppy ? R * 0.8 : R * 0.6;
  const tipOf = (x: number, y: number, r: number): [number, number] => {
    const dx = floppy ? -Math.sin(r) * earLen : Math.sin(r) * earLen;
    const dy = floppy ? Math.cos(r) * earLen : -Math.cos(r) * earLen;
    const [wx, wy] = rot(x + dx * 0.6, y + dy * 0.6, rig.hrot);
    return [rig.hx + wx, rig.hy + wy];
  };
  rig.earN = tipOf(enx, eny, rN);
  rig.earF = tipOf(efx, efy, rF);

  if (!floppy) { drawE(efx, efy, rF, -1); drawE(enx, eny, rN, 1); } else if (hf < 0.5) drawE(efx, efy, rF, -1);

  // head shape
  const headFluff = fluffAmp * 0.8;
  blob(ctx, 0, 0, R * (1 + p.cheekPuff * 0.05), R * 0.94, 0, 11, headFluff, 0.2);
  const g = ctx.createRadialGradient(-R * 0.3, -R * 0.4, R * 0.2, 0, 0, R * 1.1);
  g.addColorStop(0, shade(main, 0.12));
  g.addColorStop(1, shade(main, -0.06));
  fillStroke(ctx, g, line);
  // cheek fluff for fluffy body
  if (ap.body === 'fluffy' || p.floof > 0.2) {
    ctx.fillStyle = main;
    for (const sx of [-1, 1]) {
      const cx = sx * R * 0.86 + faceX * 0.3, cy = R * 0.32;
      blob(ctx, cx, cy, R * 0.26, R * 0.2, sx * 0.4, 4, 0.18);
      fillStroke(ctx, main, line);
    }
  }
  // patch / star markings
  const eyeY = R * 0.06;
  const nearX = faceX + lerp(R * 0.3, R * 0.36, hf);
  const farX = faceX - lerp(R * 0.3, R * 0.36, hf);
  const farS = lerp(0.8, 1, hf);
  if (ap.marking === 'patch') {
    ctx.save();
    blob(ctx, 0, 0, R, R * 0.94, 0, 11, headFluff, 0.2); ctx.clip();
    ellipse(ctx, nearX + R * 0.06, eyeY - R * 0.05, R * 0.38, R * 0.34, 0.3);
    ctx.fillStyle = dark; ctx.fill();
    ctx.restore();
  }
  if (ap.marking === 'star') {
    starPath(ctx, faceX * 0.7, -R * 0.5, R * 0.14, 5, 0.5);
    ctx.fillStyle = '#ffe066'; ctx.fill();
    ctx.strokeStyle = shade('#ffe066', -0.4); ctx.lineWidth = 1.5; ctx.stroke();
  }
  // muzzle
  const mzx = faceX + lerp(R * 0.06, 0, hf), mzy = R * 0.4;
  ellipse(ctx, mzx, mzy, R * 0.4, R * 0.27, 0);
  ctx.fillStyle = pal.belly; ctx.fill();

  if (floppy) { if (hf >= 0.5) drawE(efx, efy, rF, -1); drawE(enx, eny, rN, 1); }

  // blush
  if (p.blush > 0.02) {
    ctx.fillStyle = '#ff7f9c';
    ctx.globalAlpha = Math.min(0.55, p.blush * 0.55);
    ellipse(ctx, nearX + R * 0.08, eyeY + R * 0.34, R * 0.17 * (1 + p.cheekPuff * 0.3), R * 0.1, 0); ctx.fill();
    ellipse(ctx, farX - R * 0.08 * farS, eyeY + R * 0.34, R * 0.15 * farS * (1 + p.cheekPuff * 0.3), R * 0.1, 0); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // eyes
  const er = R * 0.2 * (1 + p.eyeWide * 0.16);
  const lx = p.lookX, ly = p.lookY;
  drawEye(ctx, p, ap, pal, farX, eyeY, er, farS, lx, ly, main, line, -1);
  drawEye(ctx, p, ap, pal, nearX, eyeY, er, 1, lx, ly, main, line, 1);
  // brows
  if (Math.abs(p.brow) > 0.12) {
    ctx.strokeStyle = line; ctx.lineWidth = 2.5;
    for (const [ex, s] of [[nearX, 1], [farX, -1]] as [number, number][]) {
      const by = eyeY - er * 1.45 - p.brow * 4;
      ctx.beginPath();
      ctx.moveTo(ex - er * 0.5, by + (p.brow < 0 ? s * -p.brow * 5 : 0) * -1);
      ctx.lineTo(ex + er * 0.5, by + (p.brow < 0 ? s * -p.brow * 5 : 0));
      ctx.stroke();
    }
  }

  // nose
  const nx = faceX + lerp(R * 0.1, 0, hf), ny = R * 0.3;
  const sn = p.sniff > 0 ? Math.sin(p.time * 30) * 1.5 * p.sniff : 0;
  ctx.beginPath();
  ctx.moveTo(nx - R * 0.08, ny - R * 0.03 + sn);
  ctx.quadraticCurveTo(nx, ny - R * 0.07 + sn, nx + R * 0.08, ny - R * 0.03 + sn);
  ctx.quadraticCurveTo(nx + R * 0.02, ny + R * 0.06 + sn, nx, ny + R * 0.06 + sn);
  ctx.quadraticCurveTo(nx - R * 0.02, ny + R * 0.06 + sn, nx - R * 0.08, ny - R * 0.03 + sn);
  ctx.fillStyle = shade(pal.inner, -0.45); ctx.fill();
  const [gnx, gny] = rot(nx, ny, rig.hrot);
  rig.noseX = rig.hx + gnx; rig.noseY = rig.hy + gny;

  // mouth
  const my = ny + R * 0.09;
  const [gmx, gmy] = rot(nx, my + R * 0.06, rig.hrot);
  rig.mouthX = rig.hx + gmx; rig.mouthY = rig.hy + gmy;
  ctx.strokeStyle = line; ctx.lineWidth = 2.4;
  const smile = p.smile;
  if (p.mouthOpen > 0.08) {
    const mw = R * (0.12 + 0.08 * Math.max(0, smile)), mh = R * 0.22 * p.mouthOpen;
    ctx.beginPath();
    ctx.moveTo(nx - mw, my);
    ctx.quadraticCurveTo(nx, my - 2 + smile * 2, nx + mw, my);
    ctx.quadraticCurveTo(nx + mw * 0.9, my + mh * 1.2, nx, my + mh * 1.3);
    ctx.quadraticCurveTo(nx - mw * 0.9, my + mh * 1.2, nx - mw, my);
    ctx.closePath();
    ctx.fillStyle = '#7a2f3f'; ctx.fill();
    ctx.save(); ctx.clip();
    ellipse(ctx, nx, my + mh * 1.2, mw * 0.75, mh * 0.6, 0);
    ctx.fillStyle = '#ff8fa3'; ctx.fill();
    ctx.restore();
    ctx.stroke();
  } else {
    // little "w" mouth; smile lifts corners, negative pouts
    const w = R * 0.1;
    ctx.beginPath();
    ctx.moveTo(nx, my - R * 0.03);
    ctx.lineTo(nx, my);
    if (smile >= 0) {
      ctx.moveTo(nx - w * 1.1, my - smile * 3);
      ctx.quadraticCurveTo(nx - w * 0.5, my + 3 + smile * 3, nx, my);
      ctx.quadraticCurveTo(nx + w * 0.5, my + 3 + smile * 3, nx + w * 1.1, my - smile * 3);
    } else {
      ctx.moveTo(nx - w * 0.8, my + 4);
      ctx.quadraticCurveTo(nx, my - smile * -1 - 1, nx + w * 0.8, my + 4);
    }
    ctx.stroke();
  }
  if (p.tongue > 0.05) {
    const tw = R * 0.07;
    ctx.beginPath();
    ctx.moveTo(nx - tw, my + 1);
    ctx.lineTo(nx - tw, my + 1 + R * 0.1 * p.tongue);
    ctx.arc(nx, my + 1 + R * 0.1 * p.tongue, tw, Math.PI, 0, true);
    ctx.lineTo(nx + tw, my + 1);
    ctx.closePath();
    ctx.fillStyle = '#ff7f99'; ctx.fill();
    ctx.lineWidth = 1.8; ctx.stroke();
  }

  drawWear(ctx, wear, R, faceX, nearX, farX, eyeY, er, farS, hf, pal);
}

function drawEye(ctx: CanvasRenderingContext2D, p: Pose, ap: Appearance, pal: Palette, x: number, y: number, er: number, sx: number,
  lx: number, ly: number, skin: string, line: string, side: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sx, 1);
  const sp = p.special;
  if (sp === 1) { // hearts
    const s = er * 1.05 * (1 + Math.sin(p.time * 10) * 0.08);
    heartPath(ctx, 0, s * 0.2, s);
    ctx.fillStyle = '#ff4f7b'; ctx.fill();
    ctx.fillStyle = '#fff'; ellipse(ctx, -s * 0.35, -s * 0.25, s * 0.18, s * 0.14, -0.5); ctx.fill();
    ctx.restore(); return;
  }
  if (sp === 2) { // dizzy spirals
    ctx.strokeStyle = '#3a2a3a'; ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (let i = 0; i < 26; i++) {
      const a = i * 0.55 + p.time * 8 * side, r = (i / 26) * er;
      const px = Math.cos(a) * r, py = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke(); ctx.restore(); return;
  }
  if (sp === 3) { // starry
    starPath(ctx, 0, 0, er * 1.05, 5, 0.5, -Math.PI / 2 + Math.sin(p.time * 6) * 0.2);
    ctx.fillStyle = '#ffd23f'; ctx.fill();
    ctx.strokeStyle = '#c98a00'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore(); return;
  }
  const closedLine = (curveUp: boolean) => {
    ctx.strokeStyle = line; ctx.lineWidth = 3;
    ctx.beginPath();
    if (curveUp) { ctx.moveTo(-er * 0.8, er * 0.25); ctx.quadraticCurveTo(0, -er * 0.75, er * 0.8, er * 0.25); }
    else { ctx.moveTo(-er * 0.8, 0); ctx.quadraticCurveTo(0, er * 0.6, er * 0.8, 0); }
    ctx.stroke();
  };
  if (sp === 4) { closedLine(false); ctx.restore(); return; }
  if (p.eyeHappy > 0.5) { closedLine(true); ctx.restore(); return; }
  const open = clamp01(p.eyeOpen);
  if (open < 0.12) { closedLine(false); ctx.restore(); return; }

  const pupil = p.pupil;
  const ox = lx * er * 0.32, oy = ly * er * 0.28;
  const drawShape = () => {
    if (ap.eyes === 'button') ellipse(ctx, 0, 0, er * 0.62, er * 0.74, 0);
    else if (ap.eyes === 'gem') ellipse(ctx, 0, 0, er * 0.92, er * 0.98, 0);
    else ellipse(ctx, 0, 0, er * 0.84, er, 0);
  };
  drawShape();
  if (ap.eyes === 'button') {
    ctx.fillStyle = '#2b2230'; ctx.fill();
    ctx.save(); ctx.clip();
    ctx.fillStyle = '#fff';
    ellipse(ctx, -er * 0.2 + ox * 0.4, -er * 0.3 + oy * 0.4, er * 0.2, er * 0.2, 0); ctx.fill();
    ctx.restore();
  } else if (ap.eyes === 'gem') {
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.strokeStyle = line; ctx.lineWidth = 2; ctx.stroke();
    ctx.save(); ctx.clip();
    ellipse(ctx, ox, oy + er * 0.05, er * 0.62, er * 0.7, 0);
    ctx.fillStyle = pal.eye; ctx.fill();
    ellipse(ctx, ox, oy + er * 0.05, er * 0.3 * pupil, er * 0.36 * pupil, 0);
    ctx.fillStyle = '#1a1420'; ctx.fill();
    ctx.fillStyle = '#fff';
    ellipse(ctx, ox - er * 0.22, oy - er * 0.25, er * 0.2, er * 0.2, 0); ctx.fill();
    ctx.restore();
  } else {
    const g = ctx.createLinearGradient(0, -er, 0, er);
    g.addColorStop(0, '#1d1522');
    g.addColorStop(0.55, pal.eye);
    g.addColorStop(1, shade(pal.eye, 0.35));
    ctx.fillStyle = g; ctx.fill();
    ctx.save(); ctx.clip();
    ellipse(ctx, ox, oy, er * 0.42 * pupil, er * 0.52 * pupil, 0);
    ctx.fillStyle = '#120c16'; ctx.fill();
    ctx.fillStyle = '#fff';
    ellipse(ctx, ox * 0.5 - er * 0.3, oy * 0.5 - er * 0.38, er * 0.3, er * 0.3, 0); ctx.fill();
    ellipse(ctx, ox * 0.5 + er * 0.3, oy * 0.5 + er * 0.38, er * 0.13, er * 0.13, 0); ctx.fill();
    ctx.restore();
  }
  // eyelid
  if (open < 0.98) {
    ctx.save();
    drawShape();
    ctx.clip();
    const lidY = -er * 1.05 + (1 - open) * er * 2.1;
    ctx.fillStyle = skin;
    ctx.fillRect(-er * 1.2, -er * 1.3, er * 2.4, lidY + er * 1.3);
    ctx.strokeStyle = line; ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.moveTo(-er * 1.2, lidY); ctx.lineTo(er * 1.2, lidY); ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function drawWear(ctx: CanvasRenderingContext2D, wear: Wear, R: number, faceX: number, nearX: number, farX: number, eyeY: number, er: number, farS: number, hf: number, pal: Palette) {
  const out = '#3a2a2a';
  ctx.lineWidth = 2.5;
  if (wear.neck) {
    const y = R * 0.86;
    if (wear.neck === 'bandana') {
      ctx.beginPath();
      ctx.moveTo(-R * 0.55 + faceX * 0.3, y - 6);
      ctx.quadraticCurveTo(faceX, y + 4, R * 0.62 + faceX * 0.3, y - 6);
      ctx.lineTo(faceX * 0.6 + R * 0.1, y + R * 0.42);
      ctx.closePath();
      ctx.fillStyle = '#e8505b'; ctx.fill(); ctx.strokeStyle = out; ctx.stroke();
      ctx.fillStyle = '#fff';
      for (const [dx, dy] of [[-0.15, 0.05], [0.2, 0.08], [0.05, 0.22]]) { ellipse(ctx, faceX * 0.6 + R * dx, y + R * dy, 2.5, 2.5, 0); ctx.fill(); }
    } else if (wear.neck === 'collar') {
      ctx.beginPath();
      ctx.moveTo(-R * 0.6 + faceX * 0.3, y - 8);
      ctx.quadraticCurveTo(faceX, y + 10, R * 0.65 + faceX * 0.3, y - 8);
      ctx.strokeStyle = out; ctx.lineWidth = 12; ctx.stroke();
      ctx.strokeStyle = '#4f8cff'; ctx.lineWidth = 8; ctx.stroke();
      ellipse(ctx, faceX * 0.7 + 4, y + 8, 7, 7, 0);
      ctx.fillStyle = '#ffd23f'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = out; ctx.stroke();
    } else if (wear.neck === 'scarf') {
      ctx.beginPath();
      ctx.moveTo(-R * 0.62 + faceX * 0.3, y - 8);
      ctx.quadraticCurveTo(faceX, y + 12, R * 0.66 + faceX * 0.3, y - 8);
      ctx.strokeStyle = out; ctx.lineWidth = 17; ctx.stroke();
      ctx.strokeStyle = '#8bd17c'; ctx.lineWidth = 13; ctx.stroke();
      ctx.setLineDash([6, 6]); ctx.strokeStyle = '#fff'; ctx.lineWidth = 13; ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#8bd17c';
      ctx.beginPath(); ctx.rect(-R * 0.35, y, 12, R * 0.45); ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = out; ctx.stroke();
    }
  }
  if (wear.face) {
    ctx.lineWidth = 3;
    if (wear.face === 'glasses') {
      ctx.strokeStyle = '#5b4636';
      ellipse(ctx, nearX, eyeY, er * 1.3, er * 1.25, 0); ctx.stroke();
      ellipse(ctx, farX, eyeY, er * 1.3 * farS, er * 1.25, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(farX + er * 1.3 * farS, eyeY); ctx.quadraticCurveTo((nearX + farX) / 2, eyeY - 6, nearX - er * 1.3, eyeY); ctx.stroke();
      ctx.fillStyle = 'rgba(200,230,255,0.25)';
      ellipse(ctx, nearX, eyeY, er * 1.3, er * 1.25, 0); ctx.fill();
    } else if (wear.face === 'stars') {
      for (const [x, s] of [[farX, farS], [nearX, 1]] as [number, number][]) {
        ctx.save(); ctx.translate(x, eyeY); ctx.scale(s, 1);
        starPath(ctx, 0, 0, er * 1.6, 5, 0.55);
        ctx.fillStyle = 'rgba(255,110,200,0.75)'; ctx.fill(); ctx.strokeStyle = '#b8327f'; ctx.stroke();
        ctx.restore();
      }
      ctx.strokeStyle = '#b8327f';
      ctx.beginPath(); ctx.moveTo(farX + er * farS, eyeY - 4); ctx.lineTo(nearX - er, eyeY - 4); ctx.stroke();
    }
  }
  if (wear.head) {
    const tx = faceX * 0.25, ty = -R * 0.86;
    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate(0.12 * (1 - hf));
    ctx.strokeStyle = out; ctx.lineWidth = 2.5;
    if (wear.head === 'partyhat') {
      ctx.beginPath(); ctx.moveTo(-R * 0.3, 4); ctx.lineTo(0, -R * 0.75); ctx.lineTo(R * 0.3, 4); ctx.closePath();
      ctx.fillStyle = '#7cc6ff'; ctx.fill(); ctx.stroke();
      ctx.save(); ctx.clip(); ctx.fillStyle = '#ffe066';
      for (let i = 0; i < 4; i++) { ellipse(ctx, -R * 0.1 + (i % 2) * R * 0.18, -R * 0.12 - i * R * 0.15, 4, 4, 0); ctx.fill(); }
      ctx.restore();
      ellipse(ctx, 0, -R * 0.78, 7, 7, 0); ctx.fillStyle = '#ff6b8b'; ctx.fill(); ctx.stroke();
    } else if (wear.head === 'beanie') {
      ctx.beginPath(); ctx.arc(0, 8, R * 0.48, Math.PI, 0); ctx.closePath();
      ctx.fillStyle = '#ffb347'; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.rect(-R * 0.5, 0, R, 12); ctx.fillStyle = '#f08a24'; ctx.fill(); ctx.stroke();
      ellipse(ctx, 0, -R * 0.44, 9, 9, 0); ctx.fillStyle = '#fff3e0'; ctx.fill(); ctx.stroke();
    } else if (wear.head === 'crown') {
      ctx.beginPath();
      ctx.moveTo(-R * 0.32, 6); ctx.lineTo(-R * 0.36, -R * 0.3); ctx.lineTo(-R * 0.15, -R * 0.12); ctx.lineTo(0, -R * 0.38);
      ctx.lineTo(R * 0.15, -R * 0.12); ctx.lineTo(R * 0.36, -R * 0.3); ctx.lineTo(R * 0.32, 6); ctx.closePath();
      ctx.fillStyle = '#ffd23f'; ctx.fill(); ctx.stroke();
      ellipse(ctx, 0, -R * 0.08, 5, 5, 0); ctx.fillStyle = '#ff4f7b'; ctx.fill();
    } else if (wear.head === 'flowers') {
      const cols = ['#ff8ab5', '#ffe066', '#9fd8ff', '#ffb0d0', '#c5a3ff'];
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI * 0.85 + i * (Math.PI * 0.7) / 4;
        const fx = Math.cos(a) * R * 0.55, fy = Math.sin(a) * R * 0.2 + 12;
        ctx.fillStyle = cols[i];
        for (let k = 0; k < 5; k++) { const b = (k / 5) * Math.PI * 2; ellipse(ctx, fx + Math.cos(b) * 5, fy + Math.sin(b) * 5, 4.5, 4.5, 0); ctx.fill(); }
        ellipse(ctx, fx, fy, 3.5, 3.5, 0); ctx.fillStyle = '#fff6b0'; ctx.fill();
      }
    } else if (wear.head === 'bow') {
      ctx.translate(R * 0.35, R * 0.05);
      ctx.fillStyle = '#ff6b8b';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-18, -16, -20, 0); ctx.quadraticCurveTo(-18, 14, 0, 0); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(18, -16, 20, 0); ctx.quadraticCurveTo(18, 14, 0, 0); ctx.fill(); ctx.stroke();
      ellipse(ctx, 0, 0, 5, 5, 0); ctx.fillStyle = '#e04468'; ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }
}

function drawDirt(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, dirt: number) {
  ctx.fillStyle = '#7a5a3a';
  ctx.globalAlpha = Math.min(0.5, dirt * 0.6);
  const spots: [number, number, number][] = [[-0.5, 0.4, 0.2], [0.3, 0.55, 0.16], [-0.1, 0.2, 0.12], [0.55, 0.1, 0.1]];
  for (const [x, y, r] of spots) { ellipse(ctx, cx + x * rx, cy + y * ry, rx * r, rx * r * 0.7, 0.3); ctx.fill(); }
  ctx.globalAlpha = 1;
}

function drawFoam(ctx: CanvasRenderingContext2D, foam: number, bcx: number, bcy: number, brx: number, bry: number, hx: number, hy: number, R: number, t: number) {
  const n = Math.floor(foam * 16);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.strokeStyle = 'rgba(150,190,230,0.9)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < n; i++) {
    const a = i * 2.39996;
    const onHead = i % 3 === 0;
    const cx = onHead ? hx + Math.cos(a) * R * 0.6 : bcx + Math.cos(a) * brx * 0.75;
    const cy = onHead ? hy - Math.abs(Math.sin(a)) * R * 0.7 : bcy + Math.sin(a) * bry * 0.6 - 4;
    const r = 7 + ((i * 7) % 6) + Math.sin(t * 3 + i) * 1.2;
    ellipse(ctx, cx, cy, r, r, 0); ctx.fill(); ctx.stroke();
  }
  // bubble crown on head
  if (foam > 0.6) {
    for (let k = 0; k < 3; k++) {
      ellipse(ctx, hx - 8 + k * 9, hy - R * 0.95 - (k === 1 ? 10 : 0), 9, 9, 0); ctx.fill(); ctx.stroke();
    }
  }
}
