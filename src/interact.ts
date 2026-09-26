// Pointer / touch handling: stroke-detected petting, pick-up & carry, taps on the pet and world.
//
// Gesture lifecycle (the part that must never get stuck):
// - Every pointer pressed on the game is tracked in `pointers` from pointerdown until its
//   pointerup/pointercancel. Ends are listened for on the window, so a release is seen even if
//   pointer capture is lost or it lands on an overlay.
// - One gesture on the pet at a time (`touch`): a second finger never takes over or orphans it.
// - A gesture always ends through finishTouch(), which drops a carried pet. cancelAll() ends
//   everything and is called when the app is hidden/backgrounded and on every scene change.
// - Safety net (update): a carried pet with no carrying finger, a gesture whose pointer is
//   gone, or a pointer that has been silent for a long time is cleaned up and reported to Diag.
import type { Game } from './game';
import type { Gen } from './pet/Pet';
import { wait } from './pet/brain';
import { petSpot, addJournal } from './memory';
import { drawIcon } from './art';
import { chance, clamp, clamp01, dist, rand } from './util';

interface Touch { id: number; zone: string | null; t0: number; sx: number; sy: number; wx: number; wy: number; moved: number; mode: 'pending' | 'stroke' | 'carry' | 'none'; floorY: number; }

/** A pointer that has been pressed but has sent nothing for this long is treated as gone. */
const SILENT_POINTER_S = 12;
/** …and a carry with no movement at all this long ends (the pet wriggles free). */
const SILENT_CARRY_S = 20;

export class Interaction {
  touch: Touch | null = null;
  /** Pointers currently pressed on the game: id → type and when we last heard from it (game time). */
  readonly pointers = new Map<number, { type: string; t: number }>();
  // petting state (read by the petting action)
  strokeRate = 0; // smoothed local-units/sec
  lastStroke = -10;
  strokeZone: string | null = null;
  private chunk: Record<string, number> = {};
  private handX = 0; handY = 0; handA = 0;
  private lastGiggle = 0;
  private lastVoice = 0;

  constructor(public g: Game) {
    const c = g.canvas;
    const safe = (f: (e: PointerEvent) => void) => (e: PointerEvent) => { try { f(e); } catch (err) { g.diag.error('input ' + e.type, err); } };
    c.addEventListener('pointerdown', safe((e) => this.down(e)));
    window.addEventListener('pointermove', safe((e) => this.move(e)), true);
    window.addEventListener('pointerup', safe((e) => this.up(e, false)), true);
    window.addEventListener('pointercancel', safe((e) => this.up(e, true)), true);
    c.addEventListener('lostpointercapture', safe((e) => this.lostCapture(e)));
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private down(e: PointerEvent) {
    const g = this.g;
    g.audio.unlock();
    // A new primary pointer means every earlier pointer of that kind was released, even if the
    // browser never told us (e.g. the app was backgrounded mid-touch): end those gestures first.
    if (e.isPrimary) for (const [id, p] of [...this.pointers]) if (id !== e.pointerId && p.type === e.pointerType) this.endPointer(id, 'stale (new primary)');
    if (this.pointers.has(e.pointerId)) this.endPointer(e.pointerId, 'pressed again');
    if (g.mode === 'title' || g.mode === 'adopt' && g.ui.adoptStep !== 'look' && g.ui.adoptStep !== 'meet') return;
    this.pointers.set(e.pointerId, { type: e.pointerType, t: g.time });
    g.diag.logThrottled('down', 'input', `down ${e.pointerType}#${e.pointerId} mode=${g.mode}${this.pointers.size > 1 ? ` (${this.pointers.size} pointers)` : ''}`, 0.5);
    const [wx, wy] = g.toWorld(e.clientX, e.clientY);
    this.setPointer(e, wx, wy);
    try { g.canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (g.mode === 'adopt') { g.ui.adoptTap(wx, wy); return; }
    if (g.mode === 'minigame' && g.mini.onDown(wx, wy, e.pointerId)) return;
    if (g.mode === 'walk' && g.walk.onDown(wx, wy)) return;
    if (g.mode === 'closeup' && g.closeup.onDown(wx, wy, e.pointerId)) return;
    const zone = g.pet.hitZone(wx, wy, g.mode === 'closeup' ? 1.05 : 1.15);
    if (zone && g.toys.active && g.toys.thr?.carried) { g.toys.petTaps++; return; }
    if (!zone && g.toys.onDown(wx, wy, e.pointerId)) return;
    if (zone) {
      // one gesture on the pet at a time: another finger never takes over (or orphans) it
      if (this.touch) return;
      this.touch = { id: e.pointerId, zone, t0: g.time, sx: e.clientX, sy: e.clientY, wx, wy, moved: 0, mode: 'pending', floorY: g.pet.y };
      return;
    }
    if (g.toys.onDown(wx, wy, e.pointerId)) return;
    if (g.mode === 'free') this.tapWorld(wx, wy);
  }

  private setPointer(e: PointerEvent, wx: number, wy: number) {
    const p = this.g.pointer;
    p.sx = e.clientX; p.sy = e.clientY; p.wx = wx; p.wy = wy;
    p.recent = true; p.lastMove = this.g.time;
  }

  private move(e: PointerEvent) {
    const g = this.g;
    const tracked = this.pointers.get(e.pointerId);
    // hovering over the HUD (or anywhere off the game) is none of our business
    if (!tracked && e.target !== g.canvas) return;
    if (tracked) tracked.t = g.time;
    if (g.mode === 'title') return;
    const [wx, wy] = g.toWorld(e.clientX, e.clientY);
    this.setPointer(e, wx, wy);
    if (!tracked) return; // a mouse just hovering: the pet may look at it, nothing else
    if (g.mode === 'closeup') g.closeup.onMove(wx, wy, e.pointerId);
    g.toys.onMove(wx, wy, e.pointerId);
    if (g.mode === 'minigame') g.mini.onMove(wx, wy, e.pointerId);
    const t = this.touch;
    if (!t || t.id !== e.pointerId) return;
    const dsx = e.clientX - t.sx, dsy = e.clientY - t.sy;
    const d = Math.hypot(dsx, dsy);
    t.moved += d; t.sx = e.clientX; t.sy = e.clientY;
    const dw = dist(t.wx, t.wy, wx, wy);
    t.wx = wx; t.wy = wy;
    if (t.mode === 'pending' && t.moved > 9) t.mode = 'stroke';
    if (t.mode === 'stroke') this.strokeAt(wx, wy, dw);
    if (t.mode === 'carry') this.carryTo(wx, wy);
  }

  /** pointerup (released) or pointercancel (the system took the touch: no tap, nothing thrown). */
  private up(e: PointerEvent, cancelled: boolean) {
    if (!this.pointers.has(e.pointerId)) return;
    if (cancelled) this.g.diag.log('input', `cancel ${e.pointerType}#${e.pointerId}`);
    this.release(e.pointerId, cancelled ? 'cancel' : 'up');
  }

  /** Capture normally goes away right after the release. If the pointer is still pressed a moment
   *  later and has gone quiet, the gesture was cut off: end it rather than leave it hanging. */
  private lostCapture(e: PointerEvent) {
    const id = e.pointerId;
    const p = this.pointers.get(id);
    if (!p) return;
    const since = p.t;
    setTimeout(() => {
      const q = this.pointers.get(id);
      if (q && q.t === since) this.endPointer(id, 'lost pointer capture');
    }, 250);
  }

  private release(id: number, how: 'up' | 'cancel' | 'stale') {
    const g = this.g;
    this.pointers.delete(id);
    try { if (g.canvas.hasPointerCapture?.(id)) g.canvas.releasePointerCapture(id); } catch { /* ignore */ }
    g.closeup.onUp(id, how !== 'up');
    g.toys.onUp(id, how !== 'up');
    const t = this.touch;
    if (t && t.id === id) this.finishTouch(t, how);
  }

  /** End a pointer's gesture without tap semantics (its release never arrived). */
  private endPointer(id: number, why: string) {
    this.g.diag.watchdog(`pointer #${id} ended: ${why}`);
    this.release(id, 'stale');
  }

  /** The one way a pet gesture ends: a carried pet is always put down. */
  private finishTouch(t: Touch, how: 'up' | 'cancel' | 'stale') {
    const g = this.g;
    if (this.touch === t) this.touch = null;
    if (t.mode === 'carry') { this.drop(); return; }
    if (how !== 'up' || t.mode !== 'pending') return;
    if (g.time - t.t0 < 0.45) this.tapPet(t.zone ?? 'back', t.wx, t.wy);
    else this.strokeAt(t.wx, t.wy, 60); // a gentle held touch counts as a pat
  }

  /**
   * End every gesture in progress (fingers lifted or not). Called when the app is hidden or loses
   * focus, and on every scene change (walks, close-ups, games, switching pets, the title screen).
   */
  cancelAll(reason: string) {
    const g = this.g;
    const had = this.pointers.size > 0 || !!this.touch || g.pet?.carried;
    for (const id of [...this.pointers.keys()]) this.release(id, 'stale');
    if (this.touch) this.finishTouch(this.touch, 'stale');
    if (g.pet?.carried) this.drop();
    g.toys.cancelDrag();
    if (had) g.diag.log('input', `cancelAll: ${reason}`);
  }

  update(dt: number) {
    const g = this.g;
    this.strokeRate *= Math.exp(-dt * 3);
    // ---- safety net: a gesture must always have a live pointer behind it ----
    if (g.pet.carried && (!this.touch || this.touch.mode !== 'carry')) { g.diag.watchdog('pet was carried with no finger holding it'); this.drop(); }
    if (this.touch && !this.pointers.has(this.touch.id)) { g.diag.watchdog('gesture without a pointer'); this.finishTouch(this.touch, 'stale'); }
    for (const [id, p] of [...this.pointers]) {
      const carrying = this.touch?.id === id && this.touch.mode === 'carry';
      if (g.time - p.t > (carrying ? SILENT_CARRY_S : SILENT_POINTER_S)) this.endPointer(id, `silent for ${Math.round(g.time - p.t)}s`);
    }
    const t = this.touch;
    if (t && t.mode === 'pending' && g.time - t.t0 > 0.45 && t.moved < 9) {
      if (g.mode === 'free' && !g.toys.active) this.startCarry();
      else { t.mode = 'stroke'; }
    }
    if (t && t.mode === 'stroke' && g.time - this.lastStroke > 0.25) {
      // finger resting on the pet still counts, gently
      this.strokeAt(t.wx, t.wy, 25 * dt * 10);
    }
  }

  // ---------- petting ----------
  strokeAt(wx: number, wy: number, dWorld: number) {
    const g = this.g, pet = g.pet;
    const zoneRaw = pet.hitZone(wx, wy, 1.25);
    if (!zoneRaw) return;
    let zone = zoneRaw === 'nose' ? 'cheeks' : zoneRaw === 'tail' ? 'back' : zoneRaw;
    const local = dWorld / pet.depth;
    this.strokeRate = this.strokeRate * 0.8 + (local / Math.max(0.016, g.time - this.lastStroke)) * 0.2;
    this.lastStroke = g.time;
    this.strokeZone = zone;
    this.handX = wx; this.handY = wy; this.handA = 1;
    if (g.pet.actionName !== 'petting' && !g.pet.carried) {
      // busy with something important (e.g. resting at the bench on a walk): the pat still counts,
      // the pet just doesn't drop what it's doing
      if (!(g.pet.busy(3) && g.pet.actionName !== 'greet')) g.pet.run(this.pettingLoop(), 'petting', 3);
      else g.brain.purr = Math.max(g.brain.purr, 0.3);
    }
    // accumulate memory in chunks
    this.chunk[zone] = (this.chunk[zone] ?? 0) + local;
    if (this.chunk[zone] > 190) {
      this.chunk[zone] = 0;
      const s = g.save;
      const r = petSpot(s.memory, s.pet.hidden, zone, 1);
      s.pet.needs.affection = clamp01(s.pet.needs.affection + 0.035 * r.intensity);
      g.bump('pets');
      g.addFriend('pet', 1.2 * r.intensity);
      g.brain.st.mark('petted', zone);
      if (s.memory.favSpot === zone) g.brain.st.mark('favSpot', zone);
      // cuddles at sleepy time turn into a bedtime habit
      if (s.pet.needs.energy < 0.45 || g.world.isNight()) g.brain.grow('bedCuddle', 0.02);
      g.brain.noteInteraction(0.03);
      if (zone === 'belly') g.brain.fulfil('belly');
      else g.brain.fulfil('heart');
      if (r.newFavorite) g.discoverSpot(zone);
      if (!s.flags.firstPet) { s.flags.firstPet = true; addJournal(s.memory, 'heart', `First cuddles with ${s.pet.name}.`); }
      if (chance(0.5)) g.fx.hearts(...pet.headPos());
    }
  }

  private *pettingLoop(): Gen {
    const g = this.g, pet = g.pet;
    const s = g.save;
    pet.moving = false;
    const close = g.mode === 'closeup';
    const lying = pet.body === 'lie' || pet.body === 'belly';
    if (!lying && !close) pet.body = 'sit';
    let level = 0, t = 0;
    let offeredBelly = false, flopped = false, favT = 0;
    while (g.time - this.lastStroke < 1.4) {
      t += pet.dt;
      const zone = this.strokeZone ?? 'head';
      const liking = (s.memory.spots[zone]?.liking ?? 0.3);
      const truth = s.pet.hidden.spot[zone] ?? 0.3;
      const fav = s.memory.favSpot === zone || truth > 0.9;
      const rate = this.strokeRate;
      const stroking = g.time - this.lastStroke < 0.3;
      const tickle = rate > 2200;
      const target = stroking ? clamp01(0.35 + liking * 0.5 + (s.pet.traits.cuddly - 0.5) * 0.3) * (tickle ? 0.6 : 1) : level * 0.97;
      level += (target - level) * Math.min(1, pet.dt * 2.2);
      const [hx] = pet.headPos();
      // lean into the hand (much harder at the favourite spot)
      const lean = fav ? 1.7 : 1;
      pet.o.tilt = clamp((this.handX - hx) * 0.0015 * pet.facing * lean, -0.12 * lean, 0.12 * lean) * level;
      pet.o.headTilt = clamp((this.handX - hx) * 0.004 * pet.facing * lean, -0.35 * lean, 0.35 * lean) * level;
      if (fav && stroking) favT += pet.dt;
      pet.lookCam = close ? 1 : 0.7;
      if (close && !lying && !flopped && !offeredBelly) pet.o.front = 1;
      if (tickle && stroking) {
        pet.expr = 'joy';
        pet.o.tilt = Math.sin(t * 30) * 0.08;
        if (g.time - this.lastGiggle > 0.9) { this.lastGiggle = g.time; g.audio.voice('giggle'); }
        pet.o.eyeOpen = undefined;
      } else if (level > (fav ? 0.35 : 0.55)) {
        pet.expr = 'bliss'; // eyes closed, melting
      } else if (level > 0.25) {
        pet.expr = 'love';
      } else {
        pet.expr = 'happy';
      }
      pet.o.earPerk = zone === 'head' || zone === 'ears' ? -0.8 * level : undefined;
      pet.o.tailWag = 0.4 + level * (fav ? 1.4 : 0.8); // the favourite spot gets the tail going
      pet.o.kick = fav && level > 0.6 && (zone === 'back' || zone === 'belly' || zone === 'ears') && stroking ? 1 : 0;
      g.brain.purr = Math.max(g.brain.purr, level * (0.6 + truth * 0.6) * (fav ? 1.25 : 1));
      // the favourite spot, long enough: melts into a flop onto its side
      if (fav && !flopped && !lying && favT > 2.4 && level > 0.6) {
        flopped = true;
        pet.body = 'lie'; pet.o.front = 0; pet.squash(0.3); g.audio.voice('coo'); pet.emote('heart');
      }
      if (stroking && g.time - this.lastVoice > 3.5 && chance(pet.dt * 2)) { this.lastVoice = g.time; g.audio.voice('coo'); }
      // a very happy pet may roll over to offer its belly
      if (!offeredBelly && level > 0.6 && t > 3 && (s.pet.hidden.spot.belly > 0.6 || g.friendLevel >= 3) && chance(pet.dt * 0.4)) {
        offeredBelly = true;
        pet.body = 'belly'; pet.o.front = 0;
        g.observe('bellyup');
      }
      yield;
    }
    pet.o = {};
    pet.expr = 'love';
    pet.lookCam = 1;
    if (level > 0.5) { g.fx.hearts(...pet.headPos()); }
    yield* wait(pet, 1.2);
    if (pet.body === 'belly') { pet.body = 'lie'; yield* wait(pet, 0.5); }
  }

  // ---------- taps ----------
  private tapPet(zone: string, wx: number, wy: number) {
    const g = this.g, pet = g.pet;
    if (g.brain.takeOffer()) return; // high five!
    g.brain.noteInteraction(0.08);
    if (g.mode === 'free' && !g.toys.active && !pet.busy(2)) { g.closeup.open('cuddle'); return; }
    if (g.mode !== 'closeup' && g.toys.active) return;
    // in the middle of something (eating, a trick, a moment on a walk): a happy look, no interruption
    if (pet.busy(3) && pet.actionName !== 'greet' && pet.actionName !== 'petting') { pet.emote('heart', 1); g.audio.voice('coo'); return; }
    const tr = g.save.pet.traits;
    pet.run((function* (): Gen {
      pet.lookCam = 1;
      // a friend a little unsure of you pulls back a touch before enjoying it
      if (g.friendLevel === 0 && tr.brave < 0.35 && chance(0.5) && !pet.asleep) { pet.expr = 'surprised'; pet.o.tilt = -0.08; yield* wait(pet, 0.35); pet.o = {}; }
      if (pet.asleep) {
        pet.o.eyeOpen = 0.4; pet.expr = 'sleepy';
        yield* wait(pet, 1); pet.asleep = true; pet.expr = 'asleep'; return;
      }
      switch (zone) {
        case 'nose':
          // boop! cross-eyed look at your finger
          pet.expr = 'surprised'; pet.o.lookX = 0; pet.squash(0.3); g.audio.voice('surprise');
          pet.lookAt = { x: pet.headPos()[0] + 10 * pet.facing, y: pet.headPos()[1] + 10 };
          yield* wait(pet, 0.5);
          if (chance(0.3)) { const b = yield* sneezeInline(); void b; }
          else { pet.expr = 'joy'; g.audio.voice('giggle'); yield* wait(pet, 0.8); }
          g.observe('boop');
          break;
        case 'belly':
          pet.expr = 'joy'; g.audio.voice('giggle'); pet.squash(0.3);
          for (let i = 0; i < 5; i++) { pet.o.tilt = i % 2 ? 0.1 : -0.1; yield* wait(pet, 0.08); }
          break;
        case 'tail':
          pet.expr = 'surprised'; pet.face(-pet.facing); pet.emote('!');
          yield* wait(pet, 0.5);
          pet.expr = 'mischief';
          for (let i = 0; i < 4; i++) { pet.face(-pet.facing); yield* wait(pet, 0.17); }
          pet.expr = 'happy'; pet.lookCam = 1;
          break;
        case 'ears':
          pet.o.earPerk = 1; pet.expr = 'surprised'; yield* wait(pet, 0.15);
          pet.o.earPerk = -0.5; pet.expr = 'happy'; g.audio.voice('coo'); yield* wait(pet, 0.6);
          break;
        default:
          pet.squash(0.25); pet.expr = tr.playful > 0.6 ? 'joy' : 'happy';
          g.audio.voice(chance(0.5) ? 'happy' : 'question');
          pet.o.headTilt = rand(-0.3, 0.3);
          yield* wait(pet, 0.7);
      }
      pet.o = {};
      pet.expr = 'happy';
      yield* wait(pet, 0.6);
    })(), 'tap', 2);
    function* sneezeInline(): Gen {
      pet.o.eyeOpen = 0.2; pet.o.headTilt = -0.2; yield* wait(pet, 0.4);
      g.audio.sneeze(); yield* wait(pet, 0.35);
      pet.squash(0.5); pet.o.eyeOpen = 0; pet.o.mouthOpen = 0.6; g.fx.drops(...pet.mouthPos(), 4, 80);
      yield* wait(pet, 0.3); pet.o = {}; pet.expr = 'happy'; pet.o.blush = 1;
      yield* wait(pet, 0.5);
    }
  }

  private tapWorld(wx: number, wy: number) {
    const g = this.g, w = g.world;
    const near = (poi: string, r: number) => { const [x, y] = w.poi(poi); return Math.hypot(x - wx, (y - 20) - wy) < r; };
    if (g.zone === 'room') {
      if (near('bowlWater', 60)) { g.closeup.refillWater(); return; }
      if (near('bowlFood', 60)) { g.closeup.fillBowl(); return; }
      if (Math.abs(wx - 985) < 40 && wy > 170 && wy < 460) { g.goZone('garden'); return; }
      if (near('basket', 70)) { g.ui.openTray('play'); return; }
      if (wy < 430) { g.pet.lookAt = { x: wx, y: wy }; g.pet.emote('?', 1); g.brain.noteInteraction(0.02); return; }
    } else {
      if (Math.abs(wx - 1985) < 60 && wy > 290 && wy < 470) { g.walk.canStart() ? g.walk.start() : g.toast('walk', 'Become Pals first!', 'walk'); return; }
      if (wx < 1030 && wy < 460) { g.goZone('room'); return; }
    }
    if (wy >= 430) g.callPet(wx, wy);
  }

  // ---------- carrying ----------
  private startCarry() {
    const g = this.g, pet = g.pet, t = this.touch!;
    t.mode = 'carry';
    pet.run((function* (): Gen {
      const brave = g.save.pet.traits.brave;
      pet.carried = true; pet.body = 'stand'; pet.lookCam = 1; pet.o.front = 0.8;
      pet.expr = 'surprised'; g.audio.voice('surprise');
      yield* wait(pet, brave > 0.5 ? 0.3 : 0.8);
      pet.expr = brave > 0.4 ? 'joy' : 'happy';
      if (brave > 0.4) g.audio.voice('giggle');
      g.observe('carried');
      while (pet.carried) { pet.o.tilt = Math.sin(g.time * 3) * 0.05; yield; }
    })(), 'carried', 4);
    t.floorY = pet.y;
  }

  private carryTo(wx: number, wy: number) {
    const g = this.g, pet = g.pet;
    const b = g.world.zoneBounds(g.zone);
    pet.x = clamp(wx, b.x0, b.x1);
    pet.y = clamp(wy + 60, b.y0, b.y1);
    pet.z = clamp(pet.y - wy - 20, 0, 600);
    pet.vz = 0;
  }

  private drop() {
    const g = this.g, pet = g.pet;
    pet.carried = false;
    pet.run((function* (): Gen {
      pet.o = {};
      pet.expr = 'surprised';
      while (pet.z > 0) yield;
      pet.expr = 'happy'; g.audio.thud();
      yield* wait(pet, 0.3);
      pet.o.shake = 0.7; yield* wait(pet, 0.35); pet.o.shake = 0;
      pet.lookCam = 1; pet.expr = 'joy'; g.audio.voice('happy');
      g.addFriend('carry', 1);
      yield* wait(pet, 0.8);
    })(), 'dropped', 3);
  }

  // ---------- draw ----------
  draw(ctx: CanvasRenderingContext2D) {
    const g = this.g;
    this.handA = Math.max(0, this.handA - 0.03);
    if (g.time - this.lastStroke < 0.4 && g.mode !== 'closeup' || (g.mode === 'closeup' && g.closeup.sub === 'cuddle' && g.time - this.lastStroke < 0.4)) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.translate(this.handX + 6, this.handY + 10);
      ctx.rotate(-0.2 + Math.sin(g.time * 8) * 0.08);
      drawIcon(ctx, 'hand', 52 / g.cam.zoom * 1.4);
      ctx.restore();
    }
  }
}
