// The pet's home: a cosy room connected to a small garden, laid out side by side.
import type { Game } from '../game';
import { decorDef } from '../data';
import { clamp, ellipse, heartPath, lerp, rand, roundRect, shade, starPath, chance, pick, dist } from '../util';
import { drawIcon } from '../art';
import { drawPet, defaultPose, newRig } from '../pet/render';

export type Zone = 'room' | 'garden';
export const ROOM = { x0: 0, x1: 1000 };
export const GARDEN = { x0: 1000, x1: 2100 };
export const FLOOR_TOP = 440, FLOOR_BOT = 690;
export const CACHE_Y0 = -260, CACHE_Y1 = 960;

export interface DigSpot { x: number; y: number; ready: boolean; t: number; }
interface Butterfly { x: number; y: number; vx: number; vy: number; t: number; col: string; land: number; lx: number; ly: number; }
interface Leaf { x: number; y: number; vy: number; rot: number; t: number; col: string; }

export class World {
  cache: Record<Zone, HTMLCanvasElement | null> = { room: null, garden: null };
  cacheRes = 1;
  cacheKey = '';
  butterflies: Butterfly[] = [];
  leaves: Leaf[] = [];
  digs: DigSpot[] = [];
  puddle = 0; // 0..1 size
  rain = 0; // intensity
  rainT = 0;
  nextRain = rand(240, 480);
  rainbow = 0;
  clouds = [0, 1, 2, 3].map((i) => ({ x: i * 600 + rand(0, 200), y: rand(-160, 60), s: rand(0.7, 1.3) }));
  birdT = rand(8, 20); bird: { x: number; y: number; dir: number } | null = null;
  fireflies = Array.from({ length: 10 }, () => ({ x: rand(1050, 2050), y: rand(300, 600), p: rand(0, 6) }));
  time = 0;

  constructor(public g: Game) {
    for (let i = 0; i < 2; i++) this.addDig();
    for (let i = 0; i < 2; i++) this.butterflies.push({ x: rand(1100, 2000), y: rand(300, 480), vx: 0, vy: 0, t: rand(0, 10), col: pick(['#ffb3d9', '#ffe066', '#a8d8ff', '#c9a8ff']), land: 0, lx: 0, ly: 0 });
  }

  depthScale(y: number) { return 0.8 + clamp((y - FLOOR_TOP) / (FLOOR_BOT - FLOOR_TOP), 0, 1) * 0.3; }
  zoneOf(x: number): Zone { return x < ROOM.x1 ? 'room' : 'garden'; }
  walkBounds() { return { x0: 50, x1: 2050, y0: FLOOR_TOP + 22, y1: FLOOR_BOT - 18 }; }
  zoneBounds(z: Zone) { return z === 'room' ? { x0: 70, x1: 930, y0: FLOOR_TOP + 25, y1: FLOOR_BOT - 20 } : { x0: 1080, x1: 2040, y0: FLOOR_TOP + 25, y1: FLOOR_BOT - 20 }; }
  randomPoint(z: Zone): [number, number] { const b = this.zoneBounds(z); return [rand(b.x0, b.x1), rand(b.y0, b.y1)]; }

  poi(name: string): [number, number] {
    switch (name) {
      case 'bed': return [150, 560];
      case 'food': return [655, 522];
      case 'water': return [765, 526];
      case 'bowlFood': return [700, 512];
      case 'bowlWater': return [805, 516];
      case 'basket': return [560, 488];
      case 'window': return [430, 478];
      case 'sunbeam': return [430, 600];
      case 'rug': return [470, 610];
      case 'door': return [980, 560];
      case 'plant': return [80, 480];
      case 'tree': return [1840, 500];
      case 'flowers': return [1230, 470];
      case 'decor': return [1360, 490];
      case 'puddle': return [1620, 630];
      case 'sunny': return [1500, 600];
      case 'fence': return [1700, 462];
    }
    return [500, 560];
  }

  /** Local hour; `?hour=13` in the URL overrides it (handy for testing day/night). */
  private hourQ = new URLSearchParams(location.search).get('hour');
  private hourCache = { h: 12, t: -1 };
  hour() {
    if (this.hourQ !== null && !isNaN(+this.hourQ)) return +this.hourQ;
    if (this.time - this.hourCache.t > 30 || this.hourCache.t < 0) { this.hourCache.t = this.time; this.hourCache.h = new Date().getHours(); }
    return this.hourCache.h;
  }
  isNight() { const h = this.hour(); return h >= 20 || h < 6; }
  isEvening() { const h = this.hour(); return h >= 17 && h < 20; }
  isDay() { return !this.isNight() && !this.isEvening(); }

  addDig() {
    if (this.digs.length >= 3) return;
    for (let tries = 0; tries < 10; tries++) {
      const x = rand(1120, 2000), y = rand(FLOOR_TOP + 50, FLOOR_BOT - 30);
      if (dist(x, y, ...this.poi('puddle')) < 90) continue;
      if (this.digs.some((d) => dist(d.x, d.y, x, y) < 120)) continue;
      this.digs.push({ x, y, ready: true, t: 0 });
      return;
    }
  }

  update(dt: number) {
    this.time += dt;
    for (const c of this.clouds) { c.x += dt * 8 * c.s; if (c.x > 2400) c.x = -300; }
    // garden weather
    this.nextRain -= dt;
    if (this.nextRain <= 0 && this.g.zone === 'garden' && this.rain === 0 && this.g.mode === 'free') {
      this.rainT = rand(18, 28); this.nextRain = rand(360, 720);
    }
    if (this.rainT > 0) {
      this.rainT -= dt;
      this.rain = Math.min(1, this.rain + dt * 0.5);
      this.puddle = Math.min(1, this.puddle + dt * 0.05);
      if (this.rainT <= 0) this.rainbow = 1;
    } else {
      this.rain = Math.max(0, this.rain - dt * 0.4);
      this.puddle = Math.max(0, this.puddle - dt * 0.002);
      this.rainbow = Math.max(0, this.rainbow - dt * 0.02);
    }
    if (this.rain > 0.2 && this.g.zone === 'garden') {
      for (let i = 0; i < 3; i++) this.g.fx.rain(rand(this.g.cam.x - 700, this.g.cam.x + 700), rand(-200, 100));
    }
    // dig spot regrowth
    if (this.digs.length < 3 && chance(dt / 90)) this.addDig();
    // butterflies
    for (const b of this.butterflies) {
      b.t += dt;
      if (b.land > 0) { b.land -= dt; if (b.land <= 0) b.vy = -40; continue; }
      const tx = 1100 + (Math.sin(b.t * 0.13) * 0.5 + 0.5) * 900, ty = 330 + Math.sin(b.t * 0.37) * 90;
      b.vx += (tx - b.x) * dt * 0.4 + Math.sin(b.t * 3.1) * 30 * dt; b.vy += (ty - b.y) * dt * 0.6 + Math.cos(b.t * 4.3) * 60 * dt;
      b.vx *= 0.98; b.vy *= 0.97;
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (chance(dt * 0.02)) { b.land = rand(3, 6); }
    }
    // leaves from the tree
    if (chance(dt * 0.15)) this.leaves.push({ x: rand(1760, 1960), y: 250, vy: rand(20, 35), rot: rand(0, 6), t: 0, col: pick(['#8bc34a', '#c5d94a', '#f2b640']) });
    for (let i = this.leaves.length - 1; i >= 0; i--) {
      const l = this.leaves[i];
      l.t += dt; l.y += l.vy * dt; l.x += Math.sin(l.t * 2) * 30 * dt; l.rot += dt;
      if (l.y > 470 + (i % 5) * 40 || l.t > 20) { if (l.t > 12) this.leaves.splice(i, 1); else { l.vy = 0; } }
    }
    // bird outside the window
    this.birdT -= dt;
    if (this.birdT <= 0 && !this.bird) { this.bird = { x: 320, y: rand(150, 230), dir: 1 }; this.birdT = rand(15, 35); }
    if (this.bird) { this.bird.x += dt * 70; if (this.bird.x > 540) this.bird = null; }
  }

  // ---------- rendering ----------
  ensureCache(res: number) {
    const d = this.g.save.equipped.decor;
    const tod = this.isNight() ? 'n' : this.isEvening() ? 'e' : 'd';
    const key = `${res.toFixed(2)}|${Object.values(d).join(',')}|${tod}|${this.g.save.pet.appearance.palette}|${this.g.settings.highContrast}`;
    if (key === this.cacheKey) return;
    this.cacheKey = key;
    this.cacheRes = res;
    for (const z of ['room', 'garden'] as Zone[]) {
      const b = z === 'room' ? ROOM : GARDEN;
      const w = (b.x1 - b.x0 + 200) * res, h = (CACHE_Y1 - CACHE_Y0) * res;
      const cv = this.cache[z] ?? document.createElement('canvas');
      cv.width = Math.ceil(w); cv.height = Math.ceil(h);
      const ctx = cv.getContext('2d')!;
      ctx.setTransform(res, 0, 0, res, (-b.x0 + 100) * res, -CACHE_Y0 * res);
      ctx.clearRect(b.x0 - 100, CACHE_Y0, b.x1 - b.x0 + 200, CACHE_Y1 - CACHE_Y0);
      if (z === 'room') this.paintRoom(ctx); else this.paintGarden(ctx);
      this.cache[z] = cv;
    }
  }

  drawBack(ctx: CanvasRenderingContext2D, viewX0: number, viewX1: number) {
    // garden sky (dynamic) — drawn first so the garden cache can overlay it
    if (viewX1 > GARDEN.x0 - 100) this.drawSky(ctx, GARDEN.x0 - 100, GARDEN.x1 + 100);
    if (viewX0 < ROOM.x1 + 100) this.drawWindowView(ctx);
    for (const z of ['garden', 'room'] as Zone[]) {
      const b = z === 'room' ? ROOM : GARDEN;
      if (viewX1 < b.x0 - 100 || viewX0 > b.x1 + 100) continue;
      const cv = this.cache[z];
      if (cv) ctx.drawImage(cv, b.x0 - 100, CACHE_Y0, cv.width / this.cacheRes, cv.height / this.cacheRes);
    }
    // sunbeam on the floor
    if (this.isDay() && viewX0 < ROOM.x1) {
      ctx.save();
      ctx.globalAlpha = 0.22 + Math.sin(this.time * 0.3) * 0.03;
      ctx.fillStyle = '#fff3b0';
      ctx.beginPath(); ctx.moveTo(350, 452); ctx.lineTo(505, 452); ctx.lineTo(560, 650); ctx.lineTo(330, 650); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    // flat garden things: puddle, dig spots, rainbow
    if (viewX1 > GARDEN.x0) {
      if (this.rainbow > 0.01) {
        ctx.save(); ctx.globalAlpha = this.rainbow * 0.5;
        ['#ff7a7a', '#ffc36b', '#fff27a', '#8be38b', '#7ec8ff', '#c49bff'].forEach((c, i) => { ctx.beginPath(); ctx.arc(1550, 470, 420 - i * 16, Math.PI, 0); ctx.strokeStyle = c; ctx.lineWidth = 16; ctx.stroke(); });
        ctx.restore();
      }
      if (this.puddle > 0.02) {
        const [px, py] = this.poi('puddle');
        ctx.fillStyle = 'rgba(120,170,220,0.65)';
        ellipse(ctx, px, py, 90 * this.puddle, 24 * this.puddle); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ellipse(ctx, px - 20 * this.puddle, py - 5 * this.puddle, 30 * this.puddle, 5 * this.puddle); ctx.fill();
      }
      for (const d of this.digs) this.drawDig(ctx, d);
      for (const l of this.leaves) if (l.vy === 0) this.drawLeaf(ctx, l);
    }
  }

  /** Dynamic objects that participate in depth sorting. */
  sortables(): { y: number; draw: (c: CanvasRenderingContext2D) => void }[] {
    return [
      { y: 505, draw: (c) => this.drawBowls(c) },
    ];
  }

  drawFront(ctx: CanvasRenderingContext2D, viewX0: number, viewX1: number) {
    // butterflies & falling leaves above everything in the garden
    if (viewX1 > GARDEN.x0 - 100) {
      for (const l of this.leaves) if (l.vy !== 0) this.drawLeaf(ctx, l);
      for (const b of this.butterflies) this.drawButterfly(ctx, b);
      if (this.isNight()) {
        for (const f of this.fireflies) {
          const a = 0.5 + Math.sin(this.time * 2 + f.p) * 0.5;
          const x = f.x + Math.sin(this.time * 0.5 + f.p) * 30, y = f.y + Math.cos(this.time * 0.7 + f.p) * 20;
          ctx.fillStyle = `rgba(255,240,120,${a * 0.35})`; ellipse(ctx, x, y, 9, 9); ctx.fill();
          ctx.fillStyle = `rgba(255,255,190,${a})`; ellipse(ctx, x, y, 3, 3); ctx.fill();
        }
      }
    }
  }

  /** Night/evening tint drawn after everything in the world. */
  drawTint(ctx: CanvasRenderingContext2D, x0: number, x1: number) {
    if (this.isDay() && this.rain < 0.05) return;
    const night = this.isNight();
    ctx.save();
    if (this.rain > 0.05) { ctx.fillStyle = `rgba(60,70,110,${this.rain * 0.18})`; ctx.fillRect(Math.max(GARDEN.x0, x0), CACHE_Y0, x1 - x0 + 200, CACHE_Y1 - CACHE_Y0); }
    if (!this.isDay()) {
      ctx.fillStyle = night ? 'rgba(30,30,80,0.22)' : 'rgba(255,140,80,0.1)';
      ctx.fillRect(x0 - 50, CACHE_Y0, x1 - x0 + 100, CACHE_Y1 - CACHE_Y0);
      if (night) {
        // warm lamp glow in the room
        const g = ctx.createRadialGradient(880, 330, 10, 880, 330, 420);
        g.addColorStop(0, 'rgba(255,210,120,0.35)'); g.addColorStop(1, 'rgba(255,210,120,0)');
        ctx.fillStyle = g; ctx.fillRect(400, 0, 700, 700);
      }
    }
    ctx.restore();
  }

  private drawSky(ctx: CanvasRenderingContext2D, x0: number, x1: number) {
    const night = this.isNight(), eve = this.isEvening();
    const g = ctx.createLinearGradient(0, CACHE_Y0, 0, 450);
    if (night) { g.addColorStop(0, '#1d2350'); g.addColorStop(1, '#4a4a8a'); }
    else if (eve) { g.addColorStop(0, '#7d8fd6'); g.addColorStop(1, '#ffc49a'); }
    else { g.addColorStop(0, '#7cc4ff'); g.addColorStop(1, '#d8f0ff'); }
    ctx.fillStyle = g;
    ctx.fillRect(x0, CACHE_Y0, x1 - x0, 460 - CACHE_Y0);
    if (night) {
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 40; i++) { const x = x0 + ((i * 137) % (x1 - x0)), y = CACHE_Y0 + ((i * 71) % 400); ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(this.time + i)); ctx.fillRect(x, y, 2.5, 2.5); }
      ctx.globalAlpha = 1;
      ellipse(ctx, 1300, 20, 34, 34); ctx.fillStyle = '#fff6d0'; ctx.fill();
      ellipse(ctx, 1314, 12, 30, 30); ctx.fillStyle = '#2a3066'; ctx.fill();
    } else {
      const sx = 1850, sy = eve ? 200 : 10;
      ctx.fillStyle = eve ? 'rgba(255,170,90,0.35)' : 'rgba(255,245,170,0.45)'; ellipse(ctx, sx, sy, 80, 80); ctx.fill();
      ctx.fillStyle = eve ? '#ffb070' : '#fff1a0'; ellipse(ctx, sx, sy, 48, 48); ctx.fill();
    }
    for (const c of this.clouds) if (c.x > x0 - 200 && c.x < x1 + 200) this.drawCloud(ctx, c.x, c.y, c.s, night);
  }

  private drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, night: boolean) {
    ctx.fillStyle = night ? 'rgba(160,170,220,0.4)' : this.rain > 0.3 ? '#c8ccd8' : 'rgba(255,255,255,0.92)';
    for (const [dx, dy, r] of [[-50, 10, 34], [0, -8, 46], [50, 8, 36], [20, 18, 34], [-20, 20, 30]]) { ellipse(ctx, x + dx * s, y + dy * s, r * s, r * s * 0.8); ctx.fill(); }
  }

  private drawWindowView(ctx: CanvasRenderingContext2D) {
    const x = 330, y = 110, w = 200, h = 200;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    const night = this.isNight(), eve = this.isEvening();
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    if (night) { g.addColorStop(0, '#1d2350'); g.addColorStop(1, '#3d4380'); }
    else if (eve) { g.addColorStop(0, '#8fa0e0'); g.addColorStop(1, '#ffc49a'); }
    else { g.addColorStop(0, '#8fd0ff'); g.addColorStop(1, '#e0f4ff'); }
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    if (night) { ctx.fillStyle = '#fff6d0'; ellipse(ctx, 480, 150, 16, 16); ctx.fill(); ctx.fillStyle = '#fff'; for (let i = 0; i < 8; i++) ctx.fillRect(340 + i * 23, 125 + (i * 37) % 80, 2, 2); }
    for (const c of this.clouds) this.drawCloud(ctx, x + ((c.x * 0.3) % 400) - 100, y + 60 + c.y * 0.2, 0.5, night);
    ctx.fillStyle = night ? '#2c4a3a' : '#8fce7a';
    ellipse(ctx, 400, 320, 140, 50); ctx.fill();
    ctx.fillStyle = night ? '#355a45' : '#a8dc8c';
    ellipse(ctx, 540, 330, 120, 55); ctx.fill();
    if (this.bird) {
      const b = this.bird, f = Math.sin(this.time * 16) * 6;
      ctx.strokeStyle = '#4a3a4a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(b.x - 10, b.y - f); ctx.quadraticCurveTo(b.x - 4, b.y - 4, b.x, b.y); ctx.quadraticCurveTo(b.x + 4, b.y - 4, b.x + 10, b.y - f); ctx.stroke();
    }
    ctx.restore();
  }

  private paintRoom(ctx: CanvasRenderingContext2D) {
    const d = this.g.save.equipped.decor;
    const hc = this.g.settings.highContrast;
    const night = this.isNight();
    // wall
    const wall = ctx.createLinearGradient(0, CACHE_Y0, 0, FLOOR_TOP);
    wall.addColorStop(0, '#f7d9c4'); wall.addColorStop(1, '#fbe6d4');
    ctx.fillStyle = wall; ctx.fillRect(-100, CACHE_Y0, 1100, FLOOR_TOP - CACHE_Y0);
    // wallpaper dots/hearts
    ctx.fillStyle = 'rgba(255,170,170,0.25)';
    for (let yy = -220; yy < 400; yy += 60) for (let xx = -80 + ((yy / 60) % 2) * 30; xx < 1000; xx += 60) { heartPath(ctx, xx, yy, 7); ctx.fill(); }
    // wainscot
    ctx.fillStyle = '#f1c9a9'; ctx.fillRect(-100, 330, 1100, FLOOR_TOP - 330);
    ctx.strokeStyle = '#d9a787'; ctx.lineWidth = 3;
    for (let xx = -80; xx < 1000; xx += 70) { roundRect(ctx, xx, 345, 56, 78, 6); ctx.stroke(); }
    ctx.fillStyle = '#e3b08c'; ctx.fillRect(-100, 326, 1100, 8);
    // floor
    const fl = ctx.createLinearGradient(0, FLOOR_TOP, 0, CACHE_Y1);
    fl.addColorStop(0, '#d49a6a'); fl.addColorStop(1, '#e8b88a');
    ctx.fillStyle = fl; ctx.fillRect(-100, FLOOR_TOP, 1100, CACHE_Y1 - FLOOR_TOP);
    ctx.strokeStyle = 'rgba(150,90,50,0.25)'; ctx.lineWidth = 2;
    for (let yy = FLOOR_TOP + 22, i = 0; yy < CACHE_Y1; yy += 22 + i * 3, i++) { ctx.beginPath(); ctx.moveTo(-100, yy); ctx.lineTo(1000, yy); ctx.stroke(); }
    for (let i = 0; i < 40; i++) { const yy = FLOOR_TOP + ((i * 53) % 400); const xx = ((i * 197) % 1100) - 100; ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx, yy + 20); ctx.stroke(); }
    ctx.fillStyle = '#b8794a'; ctx.fillRect(-100, FLOOR_TOP - 8, 1100, 10);
    // window frame & curtains
    const cur = decorDef(d.curtains);
    ctx.fillStyle = '#fff8ee'; roundRect(ctx, 316, 96, 228, 228, 10); ctx.fill();
    ctx.globalCompositeOperation = 'destination-out'; ctx.fillRect(330, 110, 200, 200); ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = '#fff8ee'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(430, 110); ctx.lineTo(430, 310); ctx.moveTo(330, 210); ctx.lineTo(530, 210); ctx.stroke();
    ctx.fillStyle = '#e9cfb2'; ctx.fillRect(300, 318, 260, 14);
    for (const side of [-1, 1]) {
      const cx = side < 0 ? 310 : 550;
      ctx.beginPath();
      ctx.moveTo(cx - 30 * side * -1, 84);
      ctx.lineTo(cx + 50 * side * -1, 84);
      ctx.quadraticCurveTo(cx + 10 * side * -1, 220, cx + 26 * side * -1, 336);
      ctx.lineTo(cx - 24 * side * -1, 336);
      ctx.closePath();
      ctx.fillStyle = cur.colors[0]; ctx.fill(); ctx.strokeStyle = shade(cur.colors[0], -0.25); ctx.lineWidth = 3; ctx.stroke();
      ctx.save(); ctx.clip();
      if (cur.id === 'curtains_stars') { ctx.fillStyle = cur.colors[1]; for (let k = 0; k < 8; k++) { starPath(ctx, cx + ((k * 13) % 50) * -side - 5 * side, 110 + k * 28, 6); ctx.fill(); } }
      else { ctx.strokeStyle = cur.colors[1]; ctx.lineWidth = 4; for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.moveTo(cx - 30 + k * 18, 84); ctx.lineTo(cx - 20 + k * 18, 340); ctx.stroke(); } }
      ctx.restore();
    }
    ctx.fillStyle = '#b8794a'; roundRect(ctx, 280, 76, 300, 12, 6); ctx.fill();
    // wall art
    this.paintWallArt(ctx, d.wall);
    // lamp (right)
    ctx.fillStyle = '#c9a27a'; ctx.fillRect(876, 330, 8, 150);
    ellipse(ctx, 880, 482, 30, 8); ctx.fillStyle = '#a57a52'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(845, 330); ctx.lineTo(915, 330); ctx.lineTo(900, 280); ctx.lineTo(860, 280); ctx.closePath();
    ctx.fillStyle = night ? '#ffe7a0' : '#ffd9b3'; ctx.fill(); ctx.strokeStyle = '#d9a787'; ctx.lineWidth = 3; ctx.stroke();
    // shelf with trinkets
    ctx.fillStyle = '#c08a5a'; ctx.fillRect(610, 290, 150, 10);
    ellipse(ctx, 640, 278, 14, 14); ctx.fillStyle = '#8fd3a8'; ctx.fill();
    ctx.fillStyle = '#ff9ec4'; roundRect(ctx, 670, 262, 22, 28, 4); ctx.fill();
    ctx.fillStyle = '#7fc8ff'; roundRect(ctx, 700, 270, 40, 20, 4); ctx.fill();
    // doorway to garden
    ctx.fillStyle = '#9bd88a'; ctx.fillRect(1000, 190, 100, FLOOR_TOP - 190);
    ctx.fillStyle = '#fbe6d4'; ctx.fillRect(1000, CACHE_Y0, 100, 190 - CACHE_Y0);
    ctx.fillStyle = '#c08a5a'; ctx.fillRect(985, 180, 30, FLOOR_TOP - 180 + 20);
    ctx.fillStyle = '#a56d3a'; ctx.fillRect(975, 170, 50, 16);
    // plant
    ctx.fillStyle = '#d98b5f'; ctx.beginPath(); ctx.moveTo(52, 440); ctx.lineTo(108, 440); ctx.lineTo(100, 490); ctx.lineTo(60, 490); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#6cb85a';
    for (const [a, l] of [[-0.9, 80], [-0.4, 100], [0.1, 95], [0.6, 85], [-0.2, 60]]) { ctx.save(); ctx.translate(80, 440); ctx.rotate(a); ellipse(ctx, 0, -l / 2, 14, l / 2); ctx.fill(); ctx.restore(); }
    // rug
    this.paintRug(ctx, d.rug);
    // bed
    this.paintBed(ctx, d.bed);
    // basket
    this.paintBasket(ctx, d.basket);
    if (hc) { ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(-100, CACHE_Y0, 1100, CACHE_Y1 - CACHE_Y0); }
  }

  private paintWallArt(ctx: CanvasRenderingContext2D, id: string) {
    const d = decorDef(id);
    const x = 640, y = 140, w = 110, h = 110;
    ctx.fillStyle = '#c08a4a'; roundRect(ctx, x - 8, y - 8, w + 16, h + 16, 6); ctx.fill();
    ctx.fillStyle = d.colors[0]; ctx.fillRect(x, y, w, h);
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    if (id === 'wall_sun') {
      ctx.fillStyle = d.colors[1]; ellipse(ctx, x + 55, y + 50, 22, 22); ctx.fill();
      ctx.strokeStyle = d.colors[1]; ctx.lineWidth = 4;
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(x + 55 + Math.cos(a) * 30, y + 50 + Math.sin(a) * 30); ctx.lineTo(x + 55 + Math.cos(a) * 40, y + 50 + Math.sin(a) * 40); ctx.stroke(); }
    } else if (id === 'wall_hills') {
      ctx.fillStyle = d.colors[1]; ellipse(ctx, x + 30, y + 110, 60, 40); ctx.fill(); ctx.fillStyle = shade(d.colors[1], 0.2); ellipse(ctx, x + 90, y + 115, 50, 35); ctx.fill();
      ctx.fillStyle = '#fff'; ellipse(ctx, x + 70, y + 30, 18, 9); ctx.fill();
    } else if (id === 'wall_heart') {
      heartPath(ctx, x + 55, y + 62, 36); ctx.fillStyle = d.colors[1]; ctx.fill();
    } else if (id === 'wall_portrait') {
      ctx.translate(x + 55, y + 100); ctx.scale(0.55, 0.55);
      const p = defaultPose(); p.sit = 1; p.front = 1; p.smile = 1; p.blush = 0.7; p.eyeHappy = 1;
      drawPet(ctx, p, this.g.save.pet.appearance, this.g.save.equipped.wear, newRig());
    }
    ctx.restore();
  }

  private paintRug(ctx: CanvasRenderingContext2D, id: string) {
    const d = decorDef(id);
    const [x, y] = this.poi('rug');
    ellipse(ctx, x, y, 170, 50); ctx.fillStyle = d.colors[0]; ctx.fill();
    if (id === 'rug_rainbow') d.colors.forEach((c, i) => { ellipse(ctx, x, y, 170 - i * 28, 50 - i * 8.5); ctx.fillStyle = c; ctx.fill(); });
    else if (id === 'rug_star') { ctx.fillStyle = d.colors[1]; for (let i = 0; i < 9; i++) { starPath(ctx, x - 120 + ((i * 67) % 240), y - 25 + ((i * 29) % 50), 8); ctx.fill(); } }
    else { ellipse(ctx, x, y, 140, 38); ctx.strokeStyle = d.colors[1]; ctx.lineWidth = 6; ctx.stroke(); ellipse(ctx, x, y, 90, 22); ctx.stroke(); }
  }

  private paintBed(ctx: CanvasRenderingContext2D, id: string) {
    const d = decorDef(id);
    const [x, y] = this.poi('bed');
    ctx.fillStyle = 'rgba(80,40,20,0.15)'; ellipse(ctx, x, y + 12, 120, 30); ctx.fill();
    if (id === 'bed_cloud') {
      ctx.fillStyle = d.colors[0];
      for (const [dx, dy, r] of [[-80, 0, 40], [-40, -18, 44], [10, -22, 46], [60, -14, 42], [90, 4, 34], [0, 6, 60]]) { ellipse(ctx, x + dx, y + dy, r * 1.1, r * 0.7); ctx.fill(); }
      ctx.strokeStyle = d.colors[1]; ctx.lineWidth = 3; ellipse(ctx, x, y, 95, 26); ctx.stroke();
      return;
    }
    const rim = d.colors[0], cushion = d.colors[1];
    ellipse(ctx, x, y - 6, 112, 40); ctx.fillStyle = shade(rim, -0.1); ctx.fill();
    ellipse(ctx, x, y - 12, 112, 34); ctx.fillStyle = rim; ctx.fill();
    ellipse(ctx, x, y - 8, 84, 22); ctx.fillStyle = cushion; ctx.fill();
    if (id === 'bed_donut') { const cols = ['#fff', '#7fd3ff', '#ffe066']; for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; ctx.save(); ctx.translate(x + Math.cos(a) * 98, y - 12 + Math.sin(a) * 28); ctx.rotate(a); ctx.fillStyle = cols[i % 3]; ctx.fillRect(-5, -2, 10, 4); ctx.restore(); } }
    if (id === 'bed_royal') { ctx.strokeStyle = cushion; ctx.lineWidth = 5; ellipse(ctx, x, y - 12, 108, 31); ctx.stroke(); ctx.fillStyle = cushion; for (const dx of [-100, 100]) { ellipse(ctx, x + dx, y - 12, 9, 9); ctx.fill(); } }
  }

  private paintBasket(ctx: CanvasRenderingContext2D, id: string) {
    const d = decorDef(id);
    const [x, y] = this.poi('basket');
    const owned = this.g.save.inventory.toys;
    // toys peeking out
    const peek: [string, number, number][] = [];
    if (owned.includes('ball')) peek.push(['ball', -28, -40]);
    if (owned.includes('squeaky')) peek.push(['squeaky', 22, -40]);
    if (owned.includes('wand')) peek.push(['wand', 0, -58]);
    for (const [t, dx, dy] of peek) { ctx.save(); ctx.translate(x + dx, y + dy); drawIcon(ctx, t, 36); ctx.restore(); }
    ctx.fillStyle = d.colors[0];
    roundRect(ctx, x - 60, y - 44, 120, 58, 10); ctx.fill();
    ctx.strokeStyle = d.colors[1]; ctx.lineWidth = 4;
    if (id === 'basket_wicker') { for (let yy = y - 34; yy < y + 12; yy += 11) { ctx.beginPath(); ctx.moveTo(x - 56, yy); ctx.lineTo(x + 56, yy); ctx.stroke(); } }
    else { roundRect(ctx, x - 50, y - 36, 100, 42, 6); ctx.stroke(); if (id === 'basket_pastel') { ctx.fillStyle = d.colors[1]; heartPath(ctx, x, y - 12, 12); ctx.fill(); } }
    roundRect(ctx, x - 60, y - 44, 120, 58, 10); ctx.strokeStyle = shade(d.colors[0], -0.35); ctx.lineWidth = 3; ctx.stroke();
  }

  private paintGarden(ctx: CanvasRenderingContext2D) {
    const x0 = GARDEN.x0, x1 = GARDEN.x1;
    const night = this.isNight();
    // hills
    ctx.fillStyle = night ? '#3b5a4a' : '#a8dc8c';
    ellipse(ctx, x0 + 250, 440, 420, 120); ctx.fill();
    ctx.fillStyle = night ? '#355244' : '#8fce7a';
    ellipse(ctx, x0 + 800, 450, 500, 140); ctx.fill();
    // fence
    ctx.fillStyle = night ? '#b8a898' : '#fff4e2';
    ctx.strokeStyle = '#d8c3a5'; ctx.lineWidth = 2;
    ctx.fillRect(x0, 380, x1 - x0 + 100, 10); ctx.fillRect(x0, 420, x1 - x0 + 100, 10);
    for (let x = x0 + 10; x < x1 + 100; x += 44) {
      ctx.beginPath(); ctx.moveTo(x, 450); ctx.lineTo(x, 360); ctx.lineTo(x + 13, 346); ctx.lineTo(x + 26, 360); ctx.lineTo(x + 26, 450); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // tree
    const [tx] = this.poi('tree');
    ctx.fillStyle = '#9a6a45'; ctx.beginPath(); ctx.moveTo(tx - 26, 480); ctx.lineTo(tx - 16, 250); ctx.lineTo(tx + 16, 250); ctx.lineTo(tx + 26, 480); ctx.closePath(); ctx.fill();
    ctx.fillStyle = night ? '#2f5a3a' : '#6cb85a';
    for (const [dx, dy, r] of [[-90, 230, 80], [0, 170, 105], [90, 230, 85], [-40, 280, 70], [50, 290, 70]]) { ellipse(ctx, tx + dx, dy, r, r * 0.85); ctx.fill(); }
    ctx.fillStyle = night ? '#3a6a45' : '#86cc6e';
    for (const [dx, dy, r] of [[-50, 180, 40], [40, 150, 45], [100, 220, 30]]) { ellipse(ctx, tx + dx, dy, r, r * 0.8); ctx.fill(); }
    ctx.fillStyle = '#ff6b6b';
    for (const [dx, dy] of [[-60, 220], [30, 190], [80, 250], [-20, 260], [60, 150]]) { ellipse(ctx, tx + dx, dy, 8, 8); ctx.fill(); }
    // grass
    const gr = ctx.createLinearGradient(0, FLOOR_TOP, 0, CACHE_Y1);
    gr.addColorStop(0, night ? '#3f7a4a' : '#8fd070'); gr.addColorStop(1, night ? '#4a8a55' : '#a6e08a');
    ctx.fillStyle = gr; ctx.fillRect(x0 - 100, FLOOR_TOP, x1 - x0 + 200, CACHE_Y1 - FLOOR_TOP);
    ctx.strokeStyle = night ? '#356a40' : '#6fb85a'; ctx.lineWidth = 2.5;
    for (let i = 0; i < 160; i++) {
      const x = x0 - 80 + ((i * 137) % (x1 - x0 + 160)), y = FLOOR_TOP + 10 + ((i * 89) % (CACHE_Y1 - FLOOR_TOP - 20));
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 3, y - 9); ctx.moveTo(x, y); ctx.lineTo(x + 4, y - 10); ctx.stroke();
    }
    // flower beds along the fence
    const fc = ['#ff8ab5', '#ffe066', '#ffffff', '#c9a8ff', '#ff9a6b'];
    for (let i = 0; i < 22; i++) {
      const x = x0 + 40 + i * 48 + ((i * 17) % 20), y = 452 + ((i * 7) % 14);
      if (Math.abs(x - tx) < 40) continue;
      ctx.strokeStyle = '#4f9a45'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, y + 12); ctx.lineTo(x, y); ctx.stroke();
      ctx.fillStyle = fc[i % fc.length];
      for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; ellipse(ctx, x + Math.cos(a) * 6, y + Math.sin(a) * 6, 5, 5); ctx.fill(); }
      ctx.fillStyle = '#ffcf3f'; ellipse(ctx, x, y, 3.5, 3.5); ctx.fill();
    }
    // stepping stones from the door
    ctx.fillStyle = night ? '#8a8a9a' : '#d8d4cc';
    for (const [x, y] of [[1050, 560], [1120, 590], [1200, 610]]) { ellipse(ctx, x, y, 28, 11); ctx.fill(); }
    // garden decoration slot
    this.paintGardenDecor(ctx, this.g.save.equipped.decor.garden);
  }

  private paintGardenDecor(ctx: CanvasRenderingContext2D, id: string) {
    const d = decorDef(id);
    const [x, y] = this.poi('decor');
    if (id === 'garden_birdbath') {
      ctx.fillStyle = d.colors[0]; ctx.fillRect(x - 10, y - 90, 20, 90); ellipse(ctx, x, y, 34, 10); ctx.fill();
      ellipse(ctx, x, y - 92, 60, 16); ctx.fill(); ellipse(ctx, x, y - 95, 48, 10); ctx.fillStyle = d.colors[1]; ctx.fill();
    } else if (id === 'garden_mushroom') {
      ctx.fillStyle = d.colors[1]; roundRect(ctx, x - 40, y - 80, 80, 80, 12); ctx.fill();
      ctx.fillStyle = '#a0764f'; roundRect(ctx, x - 14, y - 44, 28, 44, 12); ctx.fill();
      ctx.fillStyle = '#9fd8ff'; ellipse(ctx, x + 24, y - 55, 8, 8); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x - 80, y - 72); ctx.quadraticCurveTo(x, y - 190, x + 80, y - 72); ctx.closePath(); ctx.fillStyle = d.colors[0]; ctx.fill();
      ctx.fillStyle = '#fff'; for (const [dx, dy, r] of [[-40, -95, 12], [10, -125, 14], [45, -92, 10]]) { ellipse(ctx, x + dx, y + dy, r, r); ctx.fill(); }
    } else if (id === 'garden_pinwheels') {
      d.colors.forEach((c, i) => {
        const px = x - 50 + i * 50, py = y - 70 - (i % 2) * 20;
        ctx.strokeStyle = '#8a6a4a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, y); ctx.stroke();
        ctx.save(); ctx.translate(px, py);
        for (let k = 0; k < 4; k++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(22, -8); ctx.lineTo(8, 8); ctx.closePath(); ctx.fillStyle = c; ctx.fill(); }
        ctx.restore();
      });
    } else {
      ctx.fillStyle = '#7aa85a'; ellipse(ctx, x, y - 6, 60, 18); ctx.fill();
      ctx.fillStyle = '#ffe066'; for (let i = 0; i < 5; i++) { ellipse(ctx, x - 40 + i * 20, y - 12 - (i % 2) * 6, 5, 5); ctx.fill(); }
    }
  }

  drawBowls(ctx: CanvasRenderingContext2D) {
    const d = decorDef(this.g.save.equipped.decor.bowls);
    const [fx, fy] = this.poi('bowlFood'), [wx, wy] = this.poi('bowlWater');
    const room = this.g.save.room;
    const bowl = (x: number, y: number, col: string, fill: number, water: boolean) => {
      ctx.fillStyle = 'rgba(80,40,20,0.15)'; ellipse(ctx, x, y + 4, 44, 10); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x - 40, y - 22); ctx.quadraticCurveTo(x - 36, y + 2, x, y + 2); ctx.quadraticCurveTo(x + 36, y + 2, x + 40, y - 22); ctx.closePath();
      ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = shade(col, -0.35); ctx.lineWidth = 3; ctx.stroke();
      ellipse(ctx, x, y - 22, 40, 9); ctx.fillStyle = shade(col, -0.2); ctx.fill(); ctx.stroke();
      if (fill > 0.02) {
        if (water) {
          ellipse(ctx, x, y - 21, 34 * (0.6 + fill * 0.4), 6.5 * (0.6 + fill * 0.4)); ctx.fillStyle = '#7fc8ff'; ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.7)'; ellipse(ctx, x - 10, y - 23, 8, 2); ctx.fill();
        } else {
          ctx.fillStyle = '#c9853f';
          const n = Math.ceil(fill * 9);
          for (let i = 0; i < n; i++) { ellipse(ctx, x - 24 + (i % 5) * 12, y - 22 - Math.floor(i / 5) * 5 - fill * 3, 6, 4.5); ctx.fill(); }
        }
      }
    };
    bowl(fx, fy, d.colors[0], room.bowl, false);
    bowl(wx, wy, d.colors[1] ?? d.colors[0], room.water, true);
  }

  private drawDig(ctx: CanvasRenderingContext2D, d: DigSpot) {
    ctx.fillStyle = '#9a7048'; ellipse(ctx, d.x, d.y, 30, 10); ctx.fill();
    ctx.fillStyle = '#b8895a'; ellipse(ctx, d.x - 4, d.y - 4, 20, 7); ctx.fill();
    if (d.ready) {
      const a = 0.5 + Math.sin(this.time * 3 + d.x) * 0.5;
      ctx.save(); ctx.globalAlpha = a; ctx.translate(d.x + 16, d.y - 18); drawIcon(ctx, 'sparkle', 16); ctx.restore();
    }
  }

  private drawLeaf(ctx: CanvasRenderingContext2D, l: Leaf) {
    ctx.save(); ctx.translate(l.x, l.y); ctx.rotate(l.rot);
    ctx.fillStyle = l.col; ctx.beginPath(); ctx.moveTo(-8, 0); ctx.quadraticCurveTo(0, -8, 8, 0); ctx.quadraticCurveTo(0, 8, -8, 0); ctx.fill();
    ctx.restore();
  }

  private drawButterfly(ctx: CanvasRenderingContext2D, b: Butterfly) {
    const flap = b.land > 0 ? 0.6 + Math.sin(b.t * 3) * 0.3 : Math.abs(Math.sin(b.t * 14));
    ctx.save(); ctx.translate(b.x, b.y);
    ctx.fillStyle = b.col; ctx.strokeStyle = shade(b.col, -0.4); ctx.lineWidth = 1.5;
    for (const s of [-1, 1]) {
      ctx.save(); ctx.scale(s * (0.3 + flap * 0.7), 1);
      ellipse(ctx, 8, -5, 9, 7, 0.4); ctx.fill(); ctx.stroke();
      ellipse(ctx, 6, 5, 6, 5, -0.3); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = '#4a3340'; ellipse(ctx, 0, 0, 2, 7); ctx.fill();
    ctx.restore();
  }

  nearestButterfly(x: number, y: number) {
    let best: Butterfly | null = null, bd = 1e9;
    for (const b of this.butterflies) { const d = dist(x, y, b.x, b.y); if (d < bd) { bd = d; best = b; } }
    return best;
  }
  landButterflyOn(x: number, y: number) {
    const b = this.butterflies[0];
    if (!b) return null;
    b.x = x; b.y = y; b.land = 4;
    return b;
  }
  shooButterflies(x: number, y: number) {
    for (const b of this.butterflies) if (dist(x, y, b.x, b.y) < 150) { b.land = 0; b.vy = -120; b.vx = (b.x - x) * 2; }
  }
}

export { lerp };
