// Lightweight pooled particle system for world-space effects.
import { drawIcon } from './art';
import { ellipse, heartPath, rand, starPath } from './util';

type Kind = 'heart' | 'sparkle' | 'dust' | 'drop' | 'crumb' | 'dirt' | 'fur' | 'note' | 'rain' | 'foam' | 'star' | 'icon' | 'z';
interface P { on: boolean; k: Kind; x: number; y: number; vx: number; vy: number; g: number; life: number; max: number; s: number; rot: number; vr: number; col: string; icon: string; }

const MAX = 180;

export class FX {
  ps: P[] = Array.from({ length: MAX }, () => ({ on: false, k: 'dust' as Kind, x: 0, y: 0, vx: 0, vy: 0, g: 0, life: 0, max: 1, s: 1, rot: 0, vr: 0, col: '#fff', icon: '' }));
  reduced = false;
  private lastHeart = 0;
  private t = 0;

  spawn(k: Kind, x: number, y: number, vx: number, vy: number, life: number, s = 1, g = 0, col = '#fff', icon = '') {
    const p = this.ps.find((q) => !q.on);
    if (!p) return;
    p.on = true; p.k = k; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.g = g; p.life = life; p.max = life; p.s = s; p.col = col; p.icon = icon;
    p.rot = rand(-0.4, 0.4); p.vr = rand(-2, 2);
  }

  hearts(x: number, y: number, n = 1) {
    if (this.t - this.lastHeart < 0.35 && n === 1) return;
    this.lastHeart = this.t;
    for (let i = 0; i < n; i++) this.spawn('heart', x + rand(-20, 20), y, rand(-20, 20), rand(-70, -50), 1.4, rand(0.7, 1.1));
  }
  sparkles(x: number, y: number, n = 4, spread = 40) { for (let i = 0; i < n; i++) this.spawn('sparkle', x + rand(-spread, spread), y + rand(-spread, spread) * 0.6, rand(-20, 20), rand(-40, -10), rand(0.5, 0.9), rand(0.5, 1)); }
  stars(x: number, y: number, n = 8) { for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; this.spawn('star', x, y, Math.cos(a) * 160, Math.sin(a) * 160 - 60, 0.9, rand(0.7, 1.1), 300); } }
  dust(x: number, y: number, n = 3) { if (this.reduced) n = 1; for (let i = 0; i < n; i++) this.spawn('dust', x + rand(-20, 20), y - 4, rand(-40, 40), rand(-20, -5), 0.6, rand(0.6, 1.2)); }
  drops(x: number, y: number, n = 10, spread = 260) { for (let i = 0; i < n; i++) this.spawn('drop', x + rand(-30, 30), y + rand(-30, 30), rand(-spread, spread), rand(-spread, spread * 0.3), rand(0.6, 1), rand(0.7, 1.3), 700, '#7fc8ff'); }
  crumbs(x: number, y: number, n = 3, col = '#d49250') { for (let i = 0; i < n; i++) this.spawn('crumb', x, y, rand(-60, 60), rand(-90, -30), 0.7, rand(0.6, 1), 600, col); }
  dirt(x: number, y: number, n = 6) { for (let i = 0; i < n; i++) this.spawn('dirt', x, y, rand(-120, 120), rand(-220, -80), 0.9, rand(0.7, 1.3), 700, i % 2 ? '#8a5f3a' : '#a8784a'); }
  fur(x: number, y: number, col: string) { this.spawn('fur', x, y, rand(-20, 20), rand(-10, 20), 1.4, rand(0.7, 1.1), 20, col); }
  note(x: number, y: number) { this.spawn('note', x, y, rand(-15, 15), -45, 1.5, 1); }
  z(x: number, y: number) { this.spawn('z', x, y, 12, -22, 2.2, 1); }
  foam(x: number, y: number) { this.spawn('foam', x, y, rand(-20, 20), rand(-60, -30), rand(1.5, 2.5), rand(0.5, 1.2), -5); }
  rain(x: number, y: number) { this.spawn('rain', x, y, -40, 600, 1.2, 1, 0, '#9fc8ff'); }
  icon(x: number, y: number, icon: string) { this.spawn('icon', x, y, 0, -60, 1.2, 1, 0, '#fff', icon); }

  update(dt: number) {
    this.t += dt;
    for (const p of this.ps) {
      if (!p.on) continue;
      p.life -= dt;
      if (p.life <= 0) { p.on = false; continue; }
      p.vy += p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.k === 'heart' || p.k === 'note' || p.k === 'z') p.x += Math.sin(p.life * 6) * 20 * dt;
      if (p.k === 'rain' && p.y > 440 + (p.x % 240)) p.on = false;
      if (p.k === 'fur') { p.vx *= 0.97; p.x += Math.sin(p.life * 4) * 30 * dt; }
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    for (const p of this.ps) {
      if (!p.on) continue;
      const a = Math.min(1, p.life / (p.max * 0.4));
      ctx.globalAlpha = a;
      const s = p.s;
      switch (p.k) {
        case 'heart': heartPath(ctx, p.x, p.y, 12 * s); ctx.fillStyle = '#ff5c8a'; ctx.fill(); break;
        case 'sparkle': starPath(ctx, p.x, p.y, 9 * s, 4, 0.3, p.rot); ctx.fillStyle = '#fff3a0'; ctx.fill(); break;
        case 'star': starPath(ctx, p.x, p.y, 10 * s, 5, 0.5, p.rot); ctx.fillStyle = '#ffd23f'; ctx.fill(); break;
        case 'dust': ctx.fillStyle = 'rgba(220,200,180,0.7)'; ellipse(ctx, p.x, p.y, 10 * s * (1.5 - a * 0.5), 6 * s); ctx.fill(); break;
        case 'drop': case 'rain':
          ctx.fillStyle = p.col;
          if (p.k === 'rain') { ctx.fillRect(p.x, p.y, 2, 14); }
          else { ellipse(ctx, p.x, p.y, 4 * s, 5 * s); ctx.fill(); }
          break;
        case 'crumb': case 'dirt': ctx.fillStyle = p.col; ellipse(ctx, p.x, p.y, 3.5 * s, 3 * s); ctx.fill(); break;
        case 'fur': ctx.strokeStyle = p.col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.quadraticCurveTo(p.x + 5, p.y - 4, p.x + 9, p.y + 1); ctx.stroke(); break;
        case 'note': ctx.fillStyle = '#ff8ac0'; ctx.font = 'bold 24px system-ui'; ctx.fillText('♪', p.x, p.y); break;
        case 'z': ctx.fillStyle = '#8fa6ff'; ctx.font = `bold ${16 + (1 - p.life / p.max) * 14}px system-ui`; ctx.fillText('z', p.x, p.y); break;
        case 'foam':
          ellipse(ctx, p.x, p.y, 9 * s, 9 * s); ctx.fillStyle = 'rgba(210,240,255,0.45)'; ctx.fill();
          ctx.strokeStyle = 'rgba(120,180,230,0.8)'; ctx.lineWidth = 1.5; ctx.stroke();
          ctx.fillStyle = '#fff'; ellipse(ctx, p.x - 3 * s, p.y - 3 * s, 2 * s, 2 * s); ctx.fill();
          break;
        case 'icon': ctx.save(); ctx.translate(p.x, p.y); drawIcon(ctx, p.icon, 34); ctx.restore(); break;
      }
    }
    ctx.globalAlpha = 1;
  }
}
