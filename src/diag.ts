// Interaction-state diagnostics: a small ring buffer of recent events plus a live snapshot of
// everything that can block input (mode, modals, pointers, gestures, the pet's action, Walkies).
// Invisible in normal play. `?debug=1` in the URL (or 5 taps on the version line in Settings,
// for a home-screen app with no URL bar) shows a live overlay. Whenever a safety net fires or an
// error is caught, a report is kept in localStorage so it can still be read after a restart.
import type { Game } from './game';

export const DIAG_KEY = 'fuzzlet.diag';
export const DEBUG_KEY = 'fuzzlet.debug';

interface DiagEvent { t: number; at: number; kind: string; msg: string; n?: number; }

export class Diag {
  events: DiagEvent[] = [];
  errors = 0;
  watchdogs = 0;
  lastError = '';
  private overlay: HTMLElement | null = null;
  private overlayT = 0;
  private lastLog: Record<string, number> = {};

  constructor(private g: Game) {
    let on = false;
    try { on = new URLSearchParams(location.search).get('debug') === '1' || localStorage.getItem(DEBUG_KEY) === '1'; } catch { /* storage may be unavailable */ }
    if (on) this.showOverlay(true);
  }

  get enabled() { return !!this.overlay; }

  log(kind: string, msg: string) {
    const t = +(this.g.time ?? 0).toFixed(2), last = this.events[this.events.length - 1];
    if (last && last.kind === kind && last.msg === msg) { last.n = (last.n ?? 1) + 1; last.t = t; last.at = Date.now(); return; }
    this.events.push({ t, at: Date.now(), kind, msg });
    if (this.events.length > 80) this.events.splice(0, this.events.length - 80);
  }
  /** Like log(), but at most once every `gap` seconds per key (for chatty things like pointer events). */
  logThrottled(key: string, kind: string, msg: string, gap = 1) {
    const now = this.g.time;
    if (now - (this.lastLog[key] ?? -99) < gap) return;
    this.lastLog[key] = now;
    this.log(kind, msg);
  }

  private keptAt = -99;
  private consoleAt: Record<string, number> = {};
  error(where: string, e: unknown) {
    const msg = e instanceof Error ? `${e.message} @ ${(e.stack ?? '').split('\n').slice(1, 3).join(' | ').trim()}` : String(e);
    const now = this.g.time ?? 0;
    this.errors++;
    this.lastError = `${where}: ${msg}`;
    this.log('error', this.lastError);
    // an error that repeats every frame must not flood the console or storage
    if (now - (this.consoleAt[where] ?? -99) > 2) { this.consoleAt[where] = now; console.error(`[fuzzlet] ${where}`, e); }
    if (now - this.keptAt > 5) { this.keptAt = now; this.keep(); }
  }

  /** A safety net recovered a stale state. These should be rare; each one is recorded. */
  watchdog(msg: string) {
    this.watchdogs++;
    this.log('watchdog', msg);
    console.warn(`[fuzzlet] watchdog: ${msg}`);
    this.keep();
  }

  snapshot() {
    const g = this.g, pet = g.pet, w = g.walk, inp = g.input;
    const modals = g.ui ? g.ui.modalRoot.querySelectorAll('.backdrop').length : 0;
    return {
      mode: g.mode, zone: g.zone, time: +g.time.toFixed(1),
      hidden: typeof document !== 'undefined' ? document.hidden : false,
      modals, title: !!g.ui?.modalRoot.querySelector('.title-screen'), adopt: g.ui?.adoptStep ?? null,
      pointers: inp ? [...inp.pointers.entries()].map(([id, p]) => `${id}:${p.type}:${(g.time - p.t).toFixed(1)}s`) : [],
      gesture: inp?.touch ? `${inp.touch.id}:${inp.touch.mode}:${(g.time - inp.touch.t0).toFixed(1)}s` : null,
      pet: pet ? { action: pet.actionName || '-', pri: pet.actionPri, carried: pet.carried, asleep: pet.asleep, x: Math.round(pet.x), y: Math.round(pet.y) } : null,
      walk: w ? { active: w.active, phase: w.phase, stop: w.idx, scene: w.scene, home: w.homeNow, flow: w.hasFlow, fade: +w.fadeLevel.toFixed(2) } : null,
      closeup: g.closeup?.sub ?? null, mini: g.mini?.id ?? null, toy: g.toys?.active ?? null,
      audio: g.audio.ctx ? g.audio.ctx.state : 'none',
      pets: g.store ? g.store.order.length : 0,
      errors: this.errors, watchdogs: this.watchdogs, lastError: this.lastError,
    };
  }

  report() { return JSON.stringify({ at: new Date().toISOString(), state: this.snapshot(), events: this.events.slice(-40) }, null, 1); }

  /** Remember the latest report (survives closing the app). */
  keep() { try { localStorage.setItem(DIAG_KEY, this.report().slice(0, 24000)); } catch { /* full or unavailable */ } }
  saved(): string | null { try { return localStorage.getItem(DIAG_KEY); } catch { return null; } }

  showOverlay(on: boolean) {
    if (on && !this.overlay) {
      const el = document.createElement('pre');
      el.className = 'diag-overlay';
      el.setAttribute('aria-hidden', 'true');
      document.body.append(el);
      this.overlay = el;
    } else if (!on && this.overlay) { this.overlay.remove(); this.overlay = null; }
  }
  toggle() {
    const on = !this.overlay;
    this.showOverlay(on);
    try { if (on) localStorage.setItem(DEBUG_KEY, '1'); else localStorage.removeItem(DEBUG_KEY); } catch { /* ignore */ }
    return on;
  }

  update(dt: number) {
    if (!this.overlay) return;
    this.overlayT -= dt;
    if (this.overlayT > 0) return;
    this.overlayT = 0.25;
    const s = this.snapshot();
    const lines = [
      `mode ${s.mode} · zone ${s.zone} · modals ${s.modals}${s.title ? ' · title' : ''}${s.adopt ? ' · adopt:' + s.adopt : ''}${s.hidden ? ' · HIDDEN' : ''}`,
      `pointers [${s.pointers.join(', ')}] · gesture ${s.gesture ?? '-'}`,
      s.pet ? `pet ${s.pet.action}/${s.pet.pri}${s.pet.carried ? ' CARRIED' : ''}${s.pet.asleep ? ' asleep' : ''} @${s.pet.x},${s.pet.y}` : '',
      s.walk ? `walk ${s.walk.active ? 'ON' : 'off'} ${s.walk.phase} #${s.walk.stop} ${s.walk.scene}${s.walk.home ? ' HOME' : ''}${s.walk.flow ? '' : ' (no flow)'} fade ${s.walk.fade}` : '',
      `closeup ${s.closeup ?? '-'} · mini ${s.mini ?? '-'} · toy ${s.toy ?? '-'} · audio ${s.audio} · pets ${s.pets}`,
      `errors ${s.errors} · watchdogs ${s.watchdogs}${s.lastError ? ' · ' + s.lastError.slice(0, 90) : ''}`,
      ...this.events.slice(-6).map((e) => `${e.t.toFixed(1).padStart(7)} ${e.kind}: ${e.msg.slice(0, 80)}${e.n ? ` ×${e.n}` : ''}`),
    ];
    this.overlay.textContent = lines.filter(Boolean).join('\n');
  }
}
