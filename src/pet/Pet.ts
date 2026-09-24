// The pet entity: position, locomotion, pose/expression blending, gaze, blinking,
// secondary motion and the action (generator) runner used by the brain and activities.
import { Pose, defaultPose, drawPet, newRig, Rig } from './render';
import type { Game } from '../game';
import { clamp, clamp01, damp, lerp, rand, Spring, chance, dist } from '../util';
import { drawIcon } from '../art';

export type Gen = Generator<void, void, void>;
export type BodyPose = 'stand' | 'sit' | 'lie' | 'crouch' | 'bow' | 'belly';
export type Expr = 'neutral' | 'happy' | 'joy' | 'love' | 'bliss' | 'sleepy' | 'asleep' | 'curious' | 'surprised' | 'excited'
  | 'yuck' | 'pout' | 'mischief' | 'hungry' | 'bored' | 'dizzy' | 'starry' | 'chew' | 'focus';

type PT = Partial<Pose>;
const BODY: Record<BodyPose, PT> = {
  stand: { crouch: 0, sit: 0, lie: 0, bow: 0 },
  sit: { crouch: 0, sit: 1, lie: 0, bow: 0 },
  lie: { crouch: 0, sit: 0, lie: 1, bow: 0 },
  crouch: { crouch: 1, sit: 0, lie: 0, bow: 0.25 },
  bow: { crouch: 0.2, sit: 0, lie: 0, bow: 1 },
  belly: { crouch: 0, sit: 0, lie: 1, bow: 0 },
};
const EXPR: Record<Expr, PT> = {
  neutral: { smile: 0.35, blush: 0.25, earPerk: 0, tailUp: 0.5, tailWag: 0.25 },
  happy: { smile: 0.85, blush: 0.5, earPerk: 0.25, tailUp: 0.75, tailWag: 0.7 },
  joy: { eyeHappy: 1, mouthOpen: 0.75, smile: 1, blush: 0.8, earPerk: 0.5, tailUp: 0.9, tailWag: 1 },
  love: { eyeHappy: 1, smile: 0.9, blush: 1, earPerk: -0.25, tailUp: 0.7, tailWag: 0.6 },
  bliss: { eyeHappy: 1, smile: 0.7, blush: 0.95, earPerk: -0.6, tailUp: 0.6, tailWag: 0.45 },
  sleepy: { eyeOpen: 0.42, smile: 0.1, earPerk: -0.4, tailUp: 0.25, tailWag: 0.08, blush: 0.2 },
  asleep: { special: 4, smile: 0.25, earPerk: -0.7, tailUp: 0.12, tailWag: 0, blush: 0.35 },
  curious: { eyeWide: 0.6, earPerk: 0.9, smile: 0.1, tailUp: 0.6, tailWag: 0.2, headTilt: 0.22 },
  surprised: { eyeWide: 1, pupil: 0.7, mouthOpen: 0.5, smile: 0, earPerk: 1, tailUp: 0.8, tailWag: 0 },
  excited: { eyeWide: 0.7, pupil: 1.2, mouthOpen: 0.6, smile: 1, blush: 0.6, earPerk: 0.7, tailUp: 0.95, tailWag: 1 },
  yuck: { eyeOpen: 0.5, smile: -0.8, tongue: 0.7, brow: -0.4, earPerk: -0.35, tailUp: 0.35, tailWag: 0 },
  pout: { eyeOpen: 0.62, smile: -0.6, cheekPuff: 1, blush: 0.75, brow: -0.5, earPerk: -0.3, tailWag: 0.05, tailUp: 0.4 },
  mischief: { eyeOpen: 0.72, smile: 0.95, blush: 0.4, earPerk: 0.4, tailUp: 0.9, tailWag: 0.5, brow: 0.3 },
  hungry: { smile: 0.2, tongue: 0.35, eyeWide: 0.35, earPerk: 0.2, tailWag: 0.3 },
  bored: { eyeOpen: 0.62, smile: 0, earPerk: -0.2, tailUp: 0.3, tailWag: 0.05 },
  dizzy: { special: 2, mouthOpen: 0.35, smile: 0.5, tailWag: 0.2 },
  starry: { special: 3, mouthOpen: 0.7, smile: 1, blush: 0.8, tailWag: 1, tailUp: 1, earPerk: 0.8 },
  chew: { smile: 0.5, blush: 0.5, tailWag: 0.6, tailUp: 0.7, cheekPuff: 0.6 },
  focus: { eyeWide: 0.8, pupil: 1.35, smile: 0.2, earPerk: 1, tailUp: 0.55, tailWag: 0.15 },
};
const FACE_KEYS: (keyof Pose)[] = ['eyeOpen', 'eyeHappy', 'eyeWide', 'pupil', 'brow', 'mouthOpen', 'smile', 'tongue', 'blush', 'cheekPuff', 'earPerk', 'tailUp', 'tailWag', 'headTilt', 'special'];

export type EmoteKind = '!' | '?' | 'note' | 'heart' | 'zzz' | 'dots' | 'sweat' | 'spark' | 'hic' | 'anger';

export class Pet {
  x = 500; y = 560; z = 0; vz = 0;
  facing = 1; private facingTarget = 1; private turnP = 1;
  pose: Pose = defaultPose();
  body: BodyPose = 'stand';
  expr: Expr | null = null;
  o: PT = {}; // per-action overrides
  rig: Rig = newRig();
  // locomotion
  tx = 500; ty = 560; moving = false; speed = 100; arriveDist = 6;
  // gaze
  lookAt: { x: number; y: number } | null = null;
  lookCam = 0; // 0..1 how much to face the camera
  private glance = { x: 0, y: 0, t: 0 };
  private blinkT = 2; private blinkPhase = 0;
  private earN = new Spring(90, 7); private earF = new Spring(80, 6);
  private squashS = new Spring(260, 14);
  private lastHeadY = 0;
  // bubbles
  emoteK: EmoteKind | null = null; emoteT = 0;
  thought: string | null = null; thoughtT = 0;
  held: string | null = null; // item in mouth
  // action runner
  action: Gen | null = null; actionName = ''; actionPri = 0;
  dt = 0.016;
  asleep = false;
  carried = false;
  hatLeaf = 0;
  private stepCount = 0;

  constructor(public g: Game) {}

  get depth() { return this.g.world.depthScale(this.y); }
  get growth() { return 0.92 + this.g.friendLevel * 0.02; }

  // ---------- action runner ----------
  run(gen: Gen, name: string, pri = 0) {
    this.action = gen;
    this.actionName = name;
    this.actionPri = pri;
    this.o = {};
    this.expr = null;
    this.lookAt = null;
    this.lookCam = 0;
    this.moving = false;
    this.asleep = false;
    this.pose.kick = 0;
  }
  stop() { this.action = null; this.actionName = ''; this.actionPri = 0; this.o = {}; this.expr = null; this.moving = false; this.lookAt = null; this.lookCam = 0; this.asleep = false; }
  busy(minPri = 1) { return this.action !== null && this.actionPri >= minPri; }

  // ---------- commands ----------
  moveTo(x: number, y: number, speed = 110) {
    const b = this.g.world.walkBounds();
    this.tx = clamp(x, b.x0, b.x1);
    this.ty = clamp(y, b.y0, b.y1);
    this.speed = speed * (0.85 + this.g.save.pet.traits.energy * 0.3);
    this.moving = true;
  }
  face(dir: number) { if (dir !== 0) this.facingTarget = dir > 0 ? 1 : -1; }
  faceToward(x: number) { if (Math.abs(x - this.x) > 3) this.face(x - this.x); }
  jump(v = 260) { if (this.z <= 0.01) { this.vz = v; this.squash(-0.25); } }
  squash(amt: number) { this.squashS.v += amt * 14; }
  emote(k: EmoteKind, t = 1.6) { this.emoteK = k; this.emoteT = t; }
  think(icon: string, t = 4) { this.thought = icon; this.thoughtT = t; }
  headPos(): [number, number] {
    const s = this.depth;
    return [this.x + this.rig.hx * s * this.facing, this.y + this.rig.hy * s];
  }
  mouthPos(): [number, number] {
    const s = this.depth;
    return [this.x + this.rig.mouthX * s * this.facing, this.y + this.rig.mouthY * s];
  }
  arrived() { return !this.moving; }

  // ---------- update ----------
  update(dt: number) {
    this.dt = dt;
    const p = this.pose;
    p.time += dt;
    // action step
    if (this.action) {
      const r = this.action.next();
      if (r.done) this.stop();
    }
    // locomotion
    let spd = 0;
    if (this.moving && !this.carried) {
      const dx = this.tx - this.x, dy = this.ty - this.y;
      const d = Math.hypot(dx, dy);
      if (d < this.arriveDist) { this.moving = false; }
      else {
        const s = Math.min(this.speed, d * 4 + 30);
        this.x += (dx / d) * s * dt;
        this.y += (dy / d) * s * dt * 0.8;
        spd = s;
        if (Math.abs(dx) > 4) this.face(dx);
      }
    }
    // hop physics
    if (!this.carried && (this.z > 0 || this.vz > 0)) {
      this.vz -= 1300 * dt;
      this.z += this.vz * dt;
      if (this.z <= 0) {
        this.z = 0;
        if (this.vz < -150) { this.squash(Math.min(0.5, -this.vz / 900)); this.g.fx.dust(this.x, this.y, 3); }
        this.vz = 0;
      }
    }
    // turning through a front-facing frame
    if (this.facingTarget !== this.facing && this.turnP >= 1) this.turnP = 0;
    let turnBoost = 0;
    if (this.turnP < 1) {
      this.turnP = Math.min(1, this.turnP + dt / 0.22);
      turnBoost = Math.sin(this.turnP * Math.PI);
      if (this.turnP >= 0.5) this.facing = this.facingTarget;
    }

    // ---------- pose targets ----------
    const walkAmt = clamp01(spd / 110);
    p.walk = damp(p.walk, walkAmt > 0.05 ? Math.min(1.2, walkAmt) : 0, 12, dt);
    p.walkPhase += dt * (spd * 0.085 + 0.0);
    const bodyT = BODY[this.body];
    const exprName: Expr = this.expr ?? this.g.brain.moodExpr();
    const ex = EXPR[exprName];
    const o = this.o;
    const tgt = (k: keyof Pose, def: number) => (o[k] ?? ex[k] ?? bodyT[k] ?? def) as number;
    const rate = this.g.settings.reducedMotion ? 7 : 9;
    for (const k of ['crouch', 'sit', 'lie', 'bow'] as const) p[k] = damp(p[k], (o[k] ?? bodyT[k] ?? 0) as number, rate, dt);
    const bellyT = this.body === 'belly' ? 1 : 0;
    p.belly = damp(p.belly, o.belly ?? bellyT, 6, dt);
    const faceCam = Math.max(this.lookCam, turnBoost);
    p.front = damp(p.front, Math.max(o.front ?? 0, turnBoost * 0.95), turnBoost > 0 ? 30 : 7, dt);
    p.headFront = damp(p.headFront, Math.max(o.headFront ?? 0, faceCam * 0.8), 8, dt);
    p.headDown = damp(p.headDown, o.headDown ?? 0, 10, dt);
    p.tilt = damp(p.tilt, o.tilt ?? 0, 8, dt);
    p.paw = damp(p.paw, o.paw ?? 0, 10, dt);
    p.shake = damp(p.shake, o.shake ?? 0, 14, dt);
    p.sniff = damp(p.sniff, o.sniff ?? 0, 10, dt);
    p.kick = damp(p.kick, o.kick ?? 0, 12, dt);
    const s = this.g.save;
    const n = s.pet.needs;
    p.dirt = damp(p.dirt, clamp01((0.55 - n.clean) * 2), 2, dt);
    p.wet = damp(p.wet, o.wet ?? p.wet, 3, dt);
    p.foam = damp(p.foam, o.foam ?? p.foam, 4, dt);
    p.floof = damp(p.floof, o.floof ?? 0, 0.6, dt);
    for (const k of FACE_KEYS) {
      if (k === 'special') continue;
      const def = k === 'eyeOpen' || k === 'pupil' ? 1 : k === 'tailUp' ? 0.5 : 0;
      p[k] = damp(p[k] as number, tgt(k, def), k === 'eyeOpen' ? 14 : 10, dt) as never;
    }
    p.special = (o.special ?? ex.special ?? 0) as number;
    // walking lifts tail & perks ears
    if (p.walk > 0.3) { p.tailUp = Math.max(p.tailUp, 0.65); }
    // squash spring
    p.squash = this.squashS.update(0, dt);
    p.hop = this.z;
    p.tailPhase += dt * (2.5 + p.tailWag * 10);
    p.breath += dt * (this.asleep ? 1.7 : 3.2 + p.walk * 3);

    // ---------- blink ----------
    this.blinkT -= dt;
    if (this.blinkT <= 0 && p.special === 0) {
      this.blinkPhase = 0.13;
      this.blinkT = rand(1.8, 5.5);
      if (chance(0.2)) this.blinkT = 0.25; // double blink
    }
    if (this.blinkPhase > 0) {
      this.blinkPhase -= dt;
      p.eyeOpen = Math.min(p.eyeOpen, 0.05);
    }

    // ---------- gaze ----------
    const [hx, hy] = this.headPos();
    let lx = 0, ly = 0;
    const lookT = this.lookAt ?? this.idleGazeTarget();
    if (lookT) {
      const dx = (lookT.x - hx) * this.facing, dy = lookT.y - hy;
      lx = clamp(dx / 120, -1, 1);
      ly = clamp(dy / 120, -1, 1);
      if (dx < -60 && !this.moving && this.lookCam < 0.5 && !this.carried && this.body !== 'lie' && this.body !== 'belly' && !this.asleep) this.face(-this.facing);
    }
    if (this.lookCam > 0.3) { lx *= 1 - this.lookCam * 0.7; ly = lerp(ly, 0.15, this.lookCam); }
    p.lookX = damp(p.lookX, lx, 16, dt);
    p.lookY = damp(p.lookY, ly, 16, dt);
    // subtle head tilt toward look target when it's above/below
    if (!('headTilt' in o) && !ex.headTilt) p.headTilt = damp(p.headTilt, clamp(ly * 0.12, -0.15, 0.15), 5, dt);

    // ---------- ears & secondary motion ----------
    const headVy = (hy - this.lastHeadY) / Math.max(dt, 0.001);
    this.lastHeadY = hy;
    if (Math.abs(headVy) < 3000) { this.earN.v += headVy * 0.02; this.earF.v += headVy * 0.018; }
    if (chance(dt * 0.25)) (chance(0.5) ? this.earN : this.earF).v += rand(-6, 6); // ear twitch
    if (p.shake > 0.1) { this.earN.v += Math.sin(p.time * 40) * 8; this.earF.v += Math.cos(p.time * 40) * 8; }
    p.earSwingN = this.earN.update(0, dt);
    p.earSwingF = this.earF.update(0, dt);

    // footsteps
    if (p.walk > 0.2) {
      const st = Math.floor(p.walkPhase / Math.PI);
      if (st !== this.stepCount) { this.stepCount = st; if (spd > 200 && chance(0.4)) this.g.fx.dust(this.x - this.facing * 20, this.y, 1); this.g.audio.step(); }
    }

    if (this.emoteT > 0) { this.emoteT -= dt; if (this.emoteT <= 0) this.emoteK = null; }
    if (this.thoughtT > 0) { this.thoughtT -= dt; if (this.thoughtT <= 0) this.thought = null; }
  }

  private idleGazeTarget(): { x: number; y: number } | null {
    const g = this.g;
    // player pointer draws attention
    if (g.pointer.recent && !this.asleep) return { x: g.pointer.wx, y: g.pointer.wy };
    this.glance.t -= this.dt;
    if (this.glance.t <= 0) {
      this.glance.t = rand(0.8, 3);
      if (chance(0.35)) { this.glance.x = NaN; }
      else { this.glance.x = this.x + rand(-250, 250); this.glance.y = this.y - rand(0, 200); }
    }
    if (isNaN(this.glance.x)) return null;
    return this.glance;
  }

  // ---------- hit testing ----------
  /** Returns the body zone under a world point, or null. */
  hitZone(wx: number, wy: number, pad = 1): string | null {
    const s = this.depth;
    const lx = (wx - this.x) / (s * this.facing), ly = (wy - this.y) / s;
    const r = this.rig;
    if (dist(lx, ly, r.noseX, r.noseY) < r.R * 0.16 * pad) return 'nose';
    if (dist(lx, ly, r.earN[0], r.earN[1]) < r.R * 0.32 * pad || dist(lx, ly, r.earF[0], r.earF[1]) < r.R * 0.3 * pad) return 'ears';
    if (dist(lx, ly, r.hx, r.hy) < r.R * 1.02 * pad) return ly > r.hy + r.R * 0.15 ? 'cheeks' : 'head';
    // body ellipse
    const c = Math.cos(-r.brot), sn = Math.sin(-r.brot);
    const dx = lx - r.bx, dy = ly - r.by;
    const ex = (dx * c - dy * sn) / (r.brx * 1.12 * pad), ey = (dx * sn + dy * c) / (Math.max(r.bry, 20) * 1.2 * pad);
    if (ex * ex + ey * ey < 1) {
      if (r.upside) return 'belly';
      if (this.pose.front > 0.5 && ly > r.by - r.bry * 0.1) return 'belly';
      return 'back';
    }
    if (dist(lx, ly, r.tailX, r.tailY) < r.R * 0.38 * pad) return 'tail';
    if (ly < 0 && ly > -30 && Math.abs(lx) < r.brx * 1.1 * pad) return 'back';
    return null;
  }

  // ---------- draw ----------
  draw(ctx: CanvasRenderingContext2D) {
    const s = this.depth;
    const g = this.g;
    // shadow
    const sh = 1 / (1 + this.z / 90);
    ctx.fillStyle = 'rgba(60,40,30,0.18)';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + 2, 70 * s * sh, 13 * s * sh, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(s * this.facing, s);
    const sv = g.save;
    drawPet(ctx, this.pose, sv.pet.appearance, sv.equipped.wear, this.rig, this.growth);
    if (this.hatLeaf > 0) {
      ctx.save();
      ctx.translate(this.rig.hx + 6, this.rig.hy - this.rig.R * 0.95);
      ctx.rotate(0.5);
      ctx.fillStyle = '#9ccc4a'; ctx.strokeStyle = '#5a8a2a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-16, 0); ctx.quadraticCurveTo(0, -14, 16, 0); ctx.quadraticCurveTo(0, 14, -16, 0); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(12, 0); ctx.stroke();
      ctx.restore();
    }
    // held item in mouth
    if (this.held) {
      ctx.save();
      ctx.translate(this.rig.mouthX, this.rig.mouthY + 6);
      drawIcon(ctx, this.held, 34);
      ctx.restore();
    }
    ctx.restore();
  }

  drawBubbles(ctx: CanvasRenderingContext2D) {
    const s = this.depth;
    const [hx] = this.headPos();
    const topY = this.y + this.rig.top * s;
    const t = this.pose.time;
    if (this.emoteK) {
      const a = Math.min(1, this.emoteT * 3);
      const bob = Math.sin(t * 6) * 3;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(hx + 30 * s * this.facing, topY - 5 + bob);
      drawEmote(ctx, this.emoteK, t);
      ctx.restore();
    }
    if (this.thought) {
      const a = Math.min(1, this.thoughtT * 2);
      const pop = Math.min(1, (4 - this.thoughtT) * 5 + 0.3);
      ctx.save();
      ctx.globalAlpha = a;
      const bx = hx - 40 * this.facing, by = topY - 40 + Math.sin(t * 2) * 3;
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = 'rgba(90,70,90,0.5)';
      ctx.lineWidth = 2.5;
      for (const [dx, dy, r] of [[18, 42, 5], [10, 30, 8]] as const) {
        ctx.beginPath(); ctx.arc(bx + dx * this.facing, by + dy, r, 0, 7); ctx.fill(); ctx.stroke();
      }
      ctx.translate(bx, by);
      ctx.scale(Math.min(pop, 1), Math.min(pop, 1));
      ctx.beginPath();
      ctx.ellipse(0, 0, 38, 32, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      drawIcon(ctx, this.thought, 40);
      ctx.restore();
    }
  }
}

function drawEmote(ctx: CanvasRenderingContext2D, k: EmoteKind, t: number) {
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#5a3d4a';
  ctx.lineJoin = 'round';
  ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const txt = (s: string, col: string) => { ctx.fillStyle = col; ctx.strokeText(s, 0, 0); ctx.fillText(s, 0, 0); };
  switch (k) {
    case '!': txt('!', '#ffcf3f'); break;
    case '?': txt('?', '#7fc8ff'); break;
    case 'note': ctx.rotate(Math.sin(t * 5) * 0.2); txt('♪', '#ff8ac0'); break;
    case 'heart': drawIcon(ctx, 'heart', 30); break;
    case 'zzz': {
      ctx.font = 'bold 22px system-ui';
      for (let i = 0; i < 3; i++) {
        const ph = (t * 0.5 + i / 3) % 1;
        ctx.globalAlpha = Math.sin(ph * Math.PI);
        ctx.fillStyle = '#8fa6ff';
        ctx.fillText('z', ph * 26, -ph * 40);
      }
      ctx.globalAlpha = 1; break;
    }
    case 'dots': txt('···', '#b9a6c4'); break;
    case 'sweat': ctx.fillStyle = '#8fd0ff'; ctx.beginPath(); ctx.moveTo(0, -12); ctx.quadraticCurveTo(10, 4, 0, 8); ctx.quadraticCurveTo(-10, 4, 0, -12); ctx.fill(); ctx.stroke(); break;
    case 'spark': drawIcon(ctx, 'sparkle', 32); break;
    case 'hic': ctx.font = 'bold 20px system-ui'; txt('hic!', '#ffb3c8'); break;
    case 'anger': txt('#', '#ff8a8a'); break;
  }
}
