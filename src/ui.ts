// DOM user interface: title & adoption, HUD, trays, journal, shop, settings, toasts.
import type { Game } from './game';
import { iconURL } from './art';
import { newSave, randomAppearance, loadSave, clearSave, writeSave, Appearance, TraitId, SaveData } from './state';
import { BODY_TYPES, EAR_TYPES, TAIL_TYPES, EYE_TYPES, MARKINGS, PALETTES, NAME_IDEAS, FOODS, TOYS, WEARABLES, DECOR, DECOR_SLOTS, COLLECTIBLES, TRICKS, FRIEND_LEVELS, PET_SPOTS, SPOT_NAMES, foodDef, toyDef } from './data';
import { reactionFor, addJournal } from './memory';
import { drawPet, defaultPose, newRig } from './pet/render';
import { wait, walk, wakeUp } from './pet/brain';
import type { Gen } from './pet/Pet';
import { pick, clamp } from './util';

type Child = Node | string | null | undefined | false;
function h(tag: string, attrs: Record<string, any> = {}, ...kids: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const k in attrs) {
    const v = attrs[k];
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.setAttribute('style', v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}
const img = (id: string, cls = 'ic') => h('img', { src: iconURL(id), class: cls, alt: '', draggable: 'false' });

const LABELS: Record<string, string> = { round: 'Round', sleek: 'Sleek', fluffy: 'Fluffy', pointy: 'Pointy', floppy: 'Floppy', long: 'Bunny', curly: 'Curly', pom: 'Pom-pom', thin: 'Tufted', sparkle: 'Sparkly', button: 'Button', gem: 'Gem', none: 'Plain', socks: 'Socks', patch: 'Eye Patch', spots: 'Spots', star: 'Star', tips: 'Dipped Tips' };

export class UI {
  root: HTMLElement;
  top!: HTMLElement; bottom!: HTMLElement; tray!: HTMLElement; toasts!: HTMLElement; modalRoot!: HTMLElement; hintEl!: HTMLElement; miniHud!: HTMLElement;
  twinkleEl!: HTMLElement; friendEl!: HTMLElement;
  adoptStep: 'meet' | 'look' | 'name' | null = null;
  titleShowsPet = false;
  private trayKind: string | null = null;
  private lastTw = -1;

  constructor(public g: Game) {
    this.root = document.getElementById('ui')!;
    this.build();
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.modalRoot.childElementCount) this.closeModal();
        else if (this.trayKind) this.closeTray();
        else if (g.mode === 'closeup') g.closeup.close();
      }
    });
  }

  private build() {
    this.root.innerHTML = '';
    this.top = h('div', { class: 'hud-top' });
    this.bottom = h('div', { class: 'hud-bottom' });
    this.tray = h('div', { class: 'tray', role: 'menu' });
    this.toasts = h('div', { class: 'toasts', 'aria-live': 'polite' });
    this.hintEl = h('div', { class: 'hint', role: 'status' });
    this.miniHud = h('div', { class: 'mini-hud' });
    this.modalRoot = h('div', { class: 'modal-root' });
    this.root.append(this.top, this.bottom, this.tray, this.hintEl, this.miniHud, this.toasts, this.modalRoot);
  }

  private area = { x: 0, y: 0, w: 800, h: 600, t: -1 };
  /** Screen rectangle not covered by UI panels, used to frame the pet in close-ups. */
  focusArea() {
    const g = this.g;
    if (g.time - this.area.t < 0.4) return this.area;
    this.area.t = g.time;
    const W = g.W, H = g.H;
    const top = 70;
    let x = 0, y = top, w = W, hh = H - top;
    const panel = this.root.querySelector('.adopt-panel, .close-ui') as HTMLElement | null;
    if (panel) {
      const r = panel.getBoundingClientRect();
      if (r.left > W * 0.45) { w = r.left - 10; }
      else hh = Math.max(160, r.top - top - 6);
    }
    Object.assign(this.area, { x, y, w, h: hh });
    return this.area;
  }

  // ---------- title ----------
  showTitle() {
    const g = this.g;
    g.mode = 'title';
    this.clearHud();
    const save = loadSave();
    this.titleShowsPet = !!save;
    if (save) { g.load(save); g.pet.x = 480; g.pet.y = 600; g.pet.body = 'sit'; g.pet.lookCam = 1; }
    const card = h('div', { class: 'title-card' },
      h('div', { class: 'logo' }, h('span', { class: 'logo-my' }, 'My'), ' Fuzzlet'),
      h('p', { class: 'tagline' }, save ? `${save.pet.name} is waiting for you!` : 'A tiny magical friend who is SO happy you\'re here.'),
      h('div', { class: 'title-btns' },
        save ? h('button', { class: 'btn big primary', onclick: () => this.continueGame() }, img('heart'), 'Continue') : null,
        h('button', { class: 'btn big ' + (save ? '' : 'primary'), onclick: () => save ? this.confirmNew(save) : this.startAdopt() }, img('paw'), save ? 'New Pet' : 'Meet Your Pet'),
        save ? h('button', { class: 'btn small', onclick: () => this.confirmReset(true) }, 'Reset Save') : null,
      ),
    );
    this.modalRoot.innerHTML = '';
    const wrap = h('div', { class: 'title-screen' }, card);
    this.modalRoot.append(wrap);
    (card.querySelector('button') as HTMLButtonElement)?.focus();
  }

  private continueGame() {
    const g = this.g;
    g.audio.unlock();
    this.modalRoot.innerHTML = '';
    g.startSession(true);
  }

  private confirmNew(save: SaveData) {
    this.confirm(`Adopt a new pet? This will replace ${save.pet.name} and all their memories.`, 'Yes, new pet', () => { clearSave(); this.startAdopt(); });
  }

  confirmReset(fromTitle: boolean) {
    this.confirm('Erase your pet and ALL progress forever? This cannot be undone.', 'Erase everything', () => {
      clearSave();
      this.g.toys.clear();
      this.showTitle();
    }, true);
    void fromTitle;
  }

  confirm(text: string, yes: string, onYes: () => void, danger = false) {
    const box = h('div', { class: 'modal small', role: 'dialog', 'aria-modal': 'true' },
      h('p', { class: 'confirm-text' }, text),
    );
    const yesBtn = h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => { this.closeModal(box); onYes(); } }, yes) as HTMLButtonElement;
    const noBtn = h('button', { class: 'btn', onclick: () => this.closeModal(box) }, 'Keep my pet') as HTMLButtonElement;
    if (danger) {
      yesBtn.disabled = true;
      let n = 3;
      yesBtn.textContent = `${yes} (${n})`;
      const iv = setInterval(() => { n--; if (n <= 0) { clearInterval(iv); yesBtn.disabled = false; yesBtn.textContent = yes; } else yesBtn.textContent = `${yes} (${n})`; }, 1000);
    }
    box.append(h('div', { class: 'row' }, noBtn, yesBtn));
    this.openModal(box);
    noBtn.focus();
  }

  // ---------- adoption ----------
  startAdopt() {
    const g = this.g;
    g.audio.unlock();
    const s = newSave('', randomAppearance());
    g.load(s);
    g.mode = 'adopt';
    this.adoptStep = 'meet';
    this.titleShowsPet = true;
    this.modalRoot.innerHTML = '';
    const pet = g.pet;
    const [bx, by] = g.world.poi('bed');
    pet.x = bx; pet.y = by; pet.body = 'lie'; pet.asleep = true;
    pet.run((function* (): Gen { while (true) { pet.asleep = true; pet.body = 'lie'; if (Math.random() < pet.dt * 0.6) g.fx.z(pet.x + 30, pet.y - 90); yield; } })(), 'adoptSleep', 5);
    this.clearHud();
    this.hintEl.className = 'hint show big';
    this.hintEl.textContent = 'Shh… someone is napping in the bed. Tap to say hello!';
  }

  adoptTap(wx: number, wy: number) {
    const g = this.g, pet = g.pet;
    if (this.adoptStep === 'meet' && pet.actionName === 'adoptSleep') {
      this.hintEl.className = 'hint';
      pet.run((function* (ui: UI): Gen {
        pet.asleep = false; pet.expr = 'sleepy';
        yield* wait(pet, 0.3);
        yield* wakeUp(pet);
        pet.expr = 'surprised'; pet.emote('!'); pet.lookCam = 1; g.audio.voice('surprise'); pet.jump(250);
        yield* wait(pet, 0.7);
        pet.expr = 'curious'; pet.o.headTilt = 0.35; g.audio.voice('question');
        yield* wait(pet, 0.7);
        pet.o = {};
        yield* walk(pet, 420, 620, 220);
        pet.o.sniff = 1; pet.o.headDown = 0.2; g.audio.sniff(); pet.lookCam = 1;
        yield* wait(pet, 0.8);
        pet.o = {}; pet.expr = 'joy'; g.audio.voice('happy'); pet.jump(200);
        yield* wait(pet, 0.6);
        ui.adoptLook();
        while (true) { pet.body = 'sit'; pet.o.front = 1; pet.lookCam = 1; yield; }
      })(this), 'adoptMeet', 5);
    } else if (this.adoptStep === 'look' && pet.hitZone(wx, wy)) {
      pet.squash(0.3); g.audio.voice('giggle'); g.fx.hearts(...pet.headPos());
    }
  }

  private adoptLook() {
    this.adoptStep = 'look';
    const g = this.g;
    const ap = g.save.pet.appearance;
    const rows: { key: keyof Appearance; label: string; opts: readonly (string | number)[] }[] = [
      { key: 'body', label: 'Body', opts: BODY_TYPES },
      { key: 'ears', label: 'Ears', opts: EAR_TYPES },
      { key: 'tail', label: 'Tail', opts: TAIL_TYPES },
      { key: 'palette', label: 'Color', opts: PALETTES.map((_, i) => i) },
      { key: 'marking', label: 'Markings', opts: MARKINGS },
      { key: 'eyes', label: 'Eyes', opts: EYE_TYPES },
    ];
    const panel = h('div', { class: 'adopt-panel' });
    const render = () => {
      panel.innerHTML = '';
      panel.append(h('h2', {}, 'What does your Fuzzlet look like?'));
      for (const r of rows) {
        const cur = ap[r.key] as string | number;
        const val = r.key === 'palette' ? PALETTES[cur as number].name : LABELS[cur as string] ?? String(cur);
        const step = (d: number) => {
          const i = r.opts.indexOf(cur as never);
          (ap as any)[r.key] = r.opts[(i + d + r.opts.length) % r.opts.length];
          g.world.cacheKey = '';
          g.pet.squash(0.25); g.audio.click();
          if (Math.random() < 0.4) g.audio.voice('happy');
          render();
        };
        panel.append(h('div', { class: 'opt-row' },
          h('button', { class: 'btn icon-btn', 'aria-label': `Previous ${r.label}`, onclick: () => step(-1) }, '◀'),
          h('div', { class: 'opt-val' }, h('small', {}, r.label), r.key === 'palette' ? h('span', { class: 'swatch', style: `background:${PALETTES[cur as number].main}` }) : null, val),
          h('button', { class: 'btn icon-btn', 'aria-label': `Next ${r.label}`, onclick: () => step(1) }, '▶'),
        ));
      }
      panel.append(h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => { Object.assign(ap, randomAppearance()); g.world.cacheKey = ''; g.pet.jump(250); g.audio.voice('excited'); render(); } }, '🎲 Surprise me'),
        h('button', { class: 'btn primary', onclick: () => this.adoptName() }, 'That\'s me! ▶'),
      ));
    };
    render();
    this.modalRoot.innerHTML = '';
    this.modalRoot.append(h('div', { class: 'adopt-wrap' }, panel));
  }

  private adoptName() {
    this.adoptStep = 'name';
    const g = this.g;
    const input = h('input', { type: 'text', maxlength: '14', class: 'name-input', placeholder: 'Name…', 'aria-label': 'Pet name' }) as HTMLInputElement;
    const chips = h('div', { class: 'chips' });
    const ideas = [...NAME_IDEAS].sort(() => Math.random() - 0.5).slice(0, 6);
    for (const n of ideas) chips.append(h('button', { class: 'chip', onclick: () => { input.value = n; g.audio.click(); g.pet.o.headTilt = 0.3; } }, n));
    const done = () => {
      const name = input.value.trim() || pick(NAME_IDEAS);
      this.finishAdopt(name);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(); });
    const panel = h('div', { class: 'adopt-panel' },
      h('h2', {}, 'What\'s their name?'),
      input, chips,
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => this.adoptLook() }, '◀ Back'),
        h('button', { class: 'btn primary', onclick: done }, 'Hello, friend! ♥'),
      ),
    );
    this.modalRoot.innerHTML = '';
    this.modalRoot.append(h('div', { class: 'adopt-wrap' }, panel));
    setTimeout(() => input.focus(), 50);
  }

  private finishAdopt(name: string) {
    const g = this.g;
    const s = g.save;
    s.pet.name = name;
    s.createdAt = Date.now();
    addJournal(s.memory, 'heart', `${name} came home! The very first day together.`);
    this.adoptStep = null;
    this.modalRoot.innerHTML = '';
    writeSave(s);
    g.mode = 'free';
    g.pet.stop();
    g.pet.run((function* (): Gen {
      const pet = g.pet;
      pet.lookCam = 1; pet.expr = 'starry'; g.audio.voice('excited');
      for (let i = 0; i < 2; i++) { pet.jump(300); g.fx.hearts(pet.x, pet.y - 170, 3); yield* wait(pet, 0.5); }
      pet.expr = 'love'; pet.body = 'sit';
      yield* wait(pet, 1.5);
    })(), 'named', 3);
    g.startSession(false);
    this.banner(`Welcome home, ${name}!`);
    setTimeout(() => g.hint('tap', `Tap ${name} to cuddle, or tap the floor to call them over!`), 2600);
  }

  // ---------- HUD ----------
  clearHud() {
    this.top.innerHTML = ''; this.bottom.innerHTML = ''; this.closeTray(); this.miniHud.innerHTML = ''; this.miniHud.className = 'mini-hud';
    this.root.classList.remove('closeup', 'minigame');
  }

  refresh() {
    const g = this.g;
    if (g.mode === 'title' || g.mode === 'adopt') { this.clearHud(); return; }
    this.renderTop();
    this.root.classList.toggle('closeup', g.mode === 'closeup');
    this.root.classList.toggle('minigame', g.mode === 'minigame');
    this.bottom.innerHTML = '';
    this.closeTray();
    if (g.mode === 'free') this.renderFreeBar();
    else if (g.mode === 'closeup') this.renderCloseBar();
    else if (g.mode === 'minigame') this.renderMiniHud();
    if (g.mode !== 'minigame') { this.miniHud.innerHTML = ''; this.miniHud.className = 'mini-hud'; }
  }

  private renderTop() {
    const g = this.g, s = g.save;
    this.top.innerHTML = '';
    this.friendEl = h('button', { class: 'pill name-pill', 'aria-label': 'Pet status', onclick: () => this.openStatus() },
      h('span', { class: 'ring', style: this.ringStyle() }, img('heart', 'ic small')),
      h('span', { class: 'pet-name' }, s.pet.name),
    );
    this.twinkleEl = h('button', { class: 'pill tw-pill', 'aria-label': 'Twinkles — open shop', onclick: () => this.openShop() }, img('twinkle', 'ic small'), h('span', { class: 'tw-count' }, String(s.twinkles)));
    this.lastTw = s.twinkles;
    this.top.append(
      h('div', { class: 'top-left' }, this.friendEl),
      h('div', { class: 'top-right' },
        this.twinkleEl,
        h('button', { class: 'round-btn', 'aria-label': 'Memory book', onclick: () => this.openJournal() }, img('book')),
        h('button', { class: 'round-btn', 'aria-label': 'Shop', onclick: () => this.openShop() }, img('bag')),
        h('button', { class: 'round-btn', 'aria-label': 'Settings', onclick: () => this.openSettings() }, img('gear')),
      ),
    );
  }

  private ringStyle() {
    const g = this.g;
    const lvl = g.friendLevel;
    const cur = FRIEND_LEVELS[lvl].xp, next = FRIEND_LEVELS[lvl + 1]?.xp ?? cur + 1;
    const p = lvl >= FRIEND_LEVELS.length - 1 ? 1 : clamp((g.save.pet.friendship - cur) / (next - cur), 0, 1);
    return `--p:${(p * 100).toFixed(1)}%`;
  }

  bumpFriend() {
    const r = this.friendEl?.querySelector('.ring') as HTMLElement | null;
    if (r) r.setAttribute('style', this.ringStyle());
  }

  private barBtn(icon: string, label: string, on: () => void, extra = '') {
    return h('button', { class: 'bar-btn ' + extra, onclick: () => { this.g.audio.unlock(); this.g.audio.click(); on(); } }, img(icon), h('span', {}, label));
  }

  private renderFreeBar() {
    const g = this.g;
    const inGarden = g.zone === 'garden';
    const bar = h('nav', { class: 'bar', 'aria-label': 'Actions' },
      this.barBtn('cuddle', 'Cuddle', () => g.closeup.open('cuddle')),
      this.barBtn('feed', 'Feed', () => this.openTray('feed')),
      this.barBtn('play', 'Play', () => this.openTray('play'), g.toys.active ? 'active' : ''),
      this.barBtn('care', 'Care', () => this.openTray('care')),
      this.barBtn('tricks', 'Tricks', () => g.closeup.open('tricks')),
      inGarden ? this.barBtn('home', 'Home', () => g.goZone('room')) : this.barBtn('outside', 'Garden', () => g.goZone('garden'), g.friendLevel < 1 ? 'locked' : ''),
    );
    this.bottom.append(bar);
    if (g.toys.active) {
      const act = { ball: 'Throw!', squeaky: 'Throw!', wand: 'Wiggle!', bubbles: 'Blow!' }[g.toys.active];
      this.bottom.prepend(h('div', { class: 'toy-chip' }, img(g.toys.active, 'ic small'), h('span', { class: 'chip-hint' }, toyDef(g.toys.active).hint),
        h('button', { class: 'btn small primary', onclick: () => g.toys.quickAction() }, act),
        h('button', { class: 'btn small', onclick: () => { g.toys.clear(); this.refresh(); } }, 'Put away')));
    }
  }

  openTray(kind: string) {
    const g = this.g;
    if (g.mode !== 'free') return;
    if (this.trayKind === kind) { this.closeTray(); return; }
    this.trayKind = kind;
    this.hintEl.className = 'hint';
    this.tray.innerHTML = '';
    const item = (icon: string, label: string, on: () => void, sub?: string, disabled = false) =>
      h('button', { class: 'tray-item', disabled: disabled || undefined, onclick: () => { g.audio.click(); this.closeTray(); on(); } }, img(icon), h('span', {}, label), sub ? h('small', {}, sub) : null);
    if (kind === 'feed') {
      this.tray.append(
        item('treat', 'Hand-feed', () => g.closeup.open('feed'), 'snacks & treats'),
        item('kibble', 'Fill Bowl', () => g.closeup.fillBowl(), 'a hearty meal', g.zone !== 'room'),
        item('water', 'Fresh Water', () => g.closeup.refillWater(), '', g.zone !== 'room'),
      );
    } else if (kind === 'play') {
      for (const t of TOYS) {
        const owned = g.save.inventory.toys.includes(t.id);
        if (!owned) continue;
        this.tray.append(item(t.id, t.name, () => { g.toys.spawn(t.id); this.refresh(); }));
      }
      if (g.save.inventory.toys.includes('bubbles')) this.tray.append(item('bubbles', 'Bubble Party', () => g.mini.start('bubbles'), '40s game'));
      this.tray.append(item('dig', 'Treasure Sniff', () => g.mini.start('sniff'), g.friendLevel < 1 ? 'needs Pals' : 'garden game', g.friendLevel < 1));
      if (g.save.inventory.toys.length < TOYS.length) this.tray.append(item('bag', 'More toys', () => this.openShop('toys'), 'in the shop'));
    } else if (kind === 'care') {
      this.tray.append(
        item('brush', 'Brush', () => g.closeup.open('brush'), 'fluff the fur'),
        item('bath', 'Bath Time', () => g.closeup.open('bath'), 'bubbles!'),
      );
    }
    this.tray.className = 'tray show';
    (this.tray.querySelector('button:not([disabled])') as HTMLElement)?.focus();
    g.brain.anticipate(kind); // the pet sees what you're reaching for
  }

  closeTray() { this.trayKind = null; this.tray.className = 'tray'; this.tray.innerHTML = ''; }

  private renderCloseBar() {
    const g = this.g, cu = g.closeup;
    const tabs = h('div', { class: 'tabs', role: 'tablist' });
    const tab = (id: 'cuddle' | 'feed' | 'brush' | 'bath' | 'tricks', icon: string, label: string) =>
      h('button', { class: 'tab' + (cu.sub === id ? ' on' : ''), role: 'tab', 'aria-selected': String(cu.sub === id), onclick: () => { g.audio.click(); cu.setSub(id); } }, img(icon, 'ic small'), h('span', {}, label));
    tabs.append(tab('cuddle', 'cuddle', 'Cuddle'), tab('feed', 'feed', 'Feed'), tab('brush', 'brush', 'Brush'), tab('bath', 'bath', 'Bath'), tab('tricks', 'tricks', 'Tricks'));
    const panel = h('div', { class: 'close-panel' });
    const s = g.save;
    if (cu.sub === 'cuddle') {
      panel.append(h('p', { class: 'panel-tip' }, 'Stroke with your finger — or tap a spot:'));
      const row = h('div', { class: 'chips' });
      for (const spot of PET_SPOTS) {
        const fav = s.memory.favSpot === spot;
        row.append(h('button', { class: 'chip' + (fav ? ' fav' : ''), onclick: () => cu.autoPet(spot) }, (fav ? '♥ ' : '') + spot[0].toUpperCase() + spot.slice(1)));
      }
      panel.append(row);
    } else if (cu.sub === 'feed') {
      const row = h('div', { class: 'item-row' });
      for (const f of FOODS) {
        const n = f.id === 'kibble' ? Infinity : s.inventory.foods[f.id] ?? 0;
        if (n <= 0) continue;
        const fav = s.memory.favFood === f.id;
        row.append(h('button', { class: 'item' + (fav ? ' fav' : ''), onclick: () => { g.audio.click(); cu.offerFood(f.id); this.refresh(); } },
          img(f.id), h('span', {}, f.name), h('small', {}, n === Infinity ? '∞' : '×' + n)));
      }
      row.append(h('button', { class: 'item', onclick: () => this.openShop('food') }, img('bag'), h('span', {}, 'Get more'), h('small', {}, 'shop')));
      panel.append(row);
      if (cu.food) panel.append(h('button', { class: 'btn primary', onclick: () => cu.giveFood() }, 'Give it! ♥'));
    } else if (cu.sub === 'brush') {
      panel.append(h('p', { class: 'panel-tip' }, 'Drag the brush through the fur!'), h('button', { class: 'btn primary', onclick: () => cu.autoTool() }, img('brush', 'ic small'), 'Brush'));
    } else if (cu.sub === 'bath') {
      const stages = ['Soap', 'Rinse', 'Shake!', 'Dry'];
      const icons = ['soap', 'shower', 'water', 'towel'];
      panel.append(h('div', { class: 'stages' }, ...stages.map((st, i) => h('div', { class: 'stage' + (cu.bathStage === i ? ' on' : cu.bathStage > i ? ' done' : '') }, img(icons[i], 'ic small'), st))));
      const tips = ['Scrub bubbles all over!', 'Rinse the bubbles away!', 'Look out, SHAKE!', 'Dry off with the towel!', 'All clean!'];
      panel.append(h('p', { class: 'panel-tip' }, tips[cu.bathStage] ?? ''));
      const acts = ['Scrub', 'Rinse', '', 'Dry'];
      if (acts[cu.bathStage]) panel.append(h('button', { class: 'btn primary', onclick: () => cu.autoTool() }, img(icons[cu.bathStage], 'ic small'), acts[cu.bathStage]));
    } else if (cu.sub === 'tricks') {
      const t = cu.trick;
      if (t.phase === 'reward') {
        panel.append(h('p', { class: 'panel-tip big' }, 'They did it! Reward them:'),
          h('div', { class: 'row' },
            h('button', { class: 'btn big primary', onclick: () => cu.rewardTrick('treat') }, img('treat'), 'Treat!'),
            h('button', { class: 'btn big', onclick: () => cu.rewardTrick('praise') }, img('heart'), 'Good job!')));
      } else {
        if (t.phase === 'fail') panel.append(h('p', { class: 'panel-tip' }, 'Oops, silly! Try again ♥'));
        const row = h('div', { class: 'item-row' });
        for (const tr of TRICKS) {
          const rec = s.memory.tricks[tr.id];
          const locked = g.friendLevel < tr.level;
          const stars = rec.learned ? 3 : Math.floor(rec.prof / 34);
          row.append(h('button', { class: 'item trick' + (locked ? ' locked' : '') + (rec.learned ? ' learned' : ''), disabled: locked || undefined, onclick: () => { g.audio.click(); cu.startTrick(tr.id); } },
            img(tr.id === 'highfive' ? 'hand' : tr.id === 'sit' ? 'paw' : tr.id), h('span', {}, tr.name),
            h('small', {}, locked ? `🔒 ${FRIEND_LEVELS[tr.level].name}` : rec.learned ? 'Learned ★' : '★'.repeat(stars) + '☆'.repeat(3 - stars))));
        }
        panel.append(row);
      }
    }
    const back = h('button', { class: 'round-btn back-btn', 'aria-label': 'Back to room', onclick: () => { g.audio.click(); cu.close(); } }, img('back'));
    this.bottom.append(h('div', { class: 'close-ui' }, h('div', { class: 'close-head' }, back, tabs), panel));
  }

  private renderMiniHud() {
    const g = this.g, m = g.mini;
    this.miniHud.className = 'mini-hud show';
    this.miniHud.innerHTML = '';
    this.miniHud.append(
      h('div', { class: 'mini-title' }, m.id === 'bubbles' ? 'Bubble Party!' : 'Treasure Sniff!'),
      h('div', { class: 'mini-tip' + (m.tipHeat >= 0 ? ' heat' + m.tipHeat : ''), 'aria-live': 'polite' }, m.tip),
      h('div', { class: 'mini-bar' }, h('div', { class: 'mini-fill' })),
      h('div', { class: 'mini-score' }, img(m.id === 'bubbles' ? 'bubbles' : 'dig', 'ic small'), h('span', { class: 'score-n' }, '0')),
      h('button', { class: 'btn small', onclick: () => m.end() }, 'Finish'),
    );
  }

  miniHint(text: string, heat = -1) {
    const el = this.miniHud.querySelector('.mini-tip');
    if (!el) return;
    el.textContent = text;
    el.className = 'mini-tip' + (heat >= 0 ? ' heat' + heat : '');
    // restart the little pop so each new clue is noticed
    void (el as HTMLElement).offsetWidth; el.classList.add('pop');
  }

  miniResult(id: string, score: number, reward: number, best: boolean, petScore: number) {
    const g = this.g;
    const name = g.save.pet.name;
    const box = h('div', { class: 'modal small result', role: 'dialog' },
      h('h2', {}, id === 'bubbles' ? 'Bubble Party!' : 'Treasure Sniff!'),
      h('div', { class: 'big-num' }, String(score)),
      h('p', {}, id === 'bubbles' ? `pops together (${name} got ${petScore}!)` : `treasures found`),
      best && score > 0 ? h('p', { class: 'best' }, '★ New record! ★') : null,
      h('p', { class: 'reward' }, img('twinkle', 'ic small'), `+${reward}`),
      h('button', { class: 'btn primary', onclick: () => this.closeModal(box) }, 'Yay!'),
    );
    this.openModal(box);
    this.refresh();
  }

  update(dt: number) {
    const g = this.g;
    if (g.mode === 'minigame' && g.mini.id) {
      const f = this.miniHud.querySelector('.mini-fill') as HTMLElement | null;
      if (f) f.style.width = `${(1 - g.mini.t / g.mini.dur) * 100}%`;
      const sc = this.miniHud.querySelector('.score-n');
      if (sc && sc.textContent !== String(g.mini.score)) sc.textContent = String(g.mini.score);
    }
    if (this.twinkleEl && this.lastTw !== g.save.twinkles) {
      this.lastTw = g.save.twinkles;
      const c = this.twinkleEl.querySelector('.tw-count');
      if (c) c.textContent = String(g.save.twinkles);
    }
    void dt;
  }

  // ---------- feedback ----------
  toast(text: string, icon = 'sparkle') {
    const el = h('div', { class: 'toast' }, img(icon, 'ic small'), h('span', {}, text));
    this.toasts.append(el);
    while (this.toasts.childElementCount > 3) this.toasts.firstElementChild?.remove();
    setTimeout(() => el.classList.add('out'), 3200);
    setTimeout(() => el.remove(), 3700);
  }

  discovery(text: string, icon: string) {
    this.g.audio.reward();
    const el = h('div', { class: 'toast discovery' }, h('div', { class: 'disc-label' }, '✨ Discovery!'), h('div', { class: 'disc-body' }, img(icon), h('span', {}, text)));
    this.toasts.append(el);
    while (this.toasts.childElementCount > 3) this.toasts.firstElementChild?.remove();
    setTimeout(() => el.classList.add('out'), 5000);
    setTimeout(() => el.remove(), 5500);
  }

  earn(n: number, big: boolean) {
    if (!this.twinkleEl) return;
    const f = h('span', { class: 'earn-float' + (big ? ' big' : '') }, `+${n}`);
    this.twinkleEl.append(f);
    this.twinkleEl.classList.remove('bump'); void this.twinkleEl.offsetWidth; this.twinkleEl.classList.add('bump');
    setTimeout(() => f.remove(), 1200);
  }

  hint(text: string) {
    const place = () => { const bh = this.bottom.getBoundingClientRect().height; this.hintEl.style.bottom = `${Math.max(100, bh + 18)}px`; };
    place();
    requestAnimationFrame(place);
    this.hintEl.textContent = text;
    this.hintEl.className = 'hint show';
    const my = text;
    setTimeout(() => { if (this.hintEl.textContent === my) this.hintEl.className = 'hint'; }, 6500);
    this.hintEl.onclick = () => { this.hintEl.className = 'hint'; };
  }

  banner(text: string) {
    const el = h('div', { class: 'banner' }, text);
    this.root.append(el);
    setTimeout(() => el.classList.add('out'), 2400);
    setTimeout(() => el.remove(), 3000);
  }

  splashScreen() {
    if (this.g.settings.reducedMotion) return;
    const el = h('div', { class: 'splash' });
    for (let i = 0; i < 14; i++) el.append(h('i', { style: `left:${Math.random() * 100}%;top:${Math.random() * 80}%;animation-delay:${Math.random() * 0.3}s;transform:scale(${0.5 + Math.random()})` }));
    this.root.append(el);
    setTimeout(() => el.remove(), 2200);
  }

  celebrate(title: string, sub: string) {
    const box = h('div', { class: 'modal small celebrate', role: 'dialog' },
      img('heart', 'ic huge beat'),
      h('h2', {}, title),
      sub ? h('p', {}, sub) : null,
      h('button', { class: 'btn primary', onclick: () => this.closeModal(box) }, 'Yay!'),
    );
    this.openModal(box);
    this.refresh();
  }

  // ---------- modals ----------
  modalOpen() { return this.modalRoot.querySelector('.backdrop') !== null; }

  openModal(box: HTMLElement) {
    const back = h('div', { class: 'backdrop', onclick: (e: Event) => { if (e.target === back) this.closeModal(box); } }, box);
    this.modalRoot.append(back);
    this.g.audio.open();
    const f = box.querySelector('button, input') as HTMLElement | null;
    f?.focus();
  }

  closeModal(box?: HTMLElement) {
    const target = box ? box.parentElement : this.modalRoot.lastElementChild;
    if (target && target.classList.contains('backdrop')) target.remove();
    else if (!box) { /* title screen etc. stays */ }
  }

  private modalShell(title: string, body: HTMLElement, tabs?: HTMLElement) {
    body.classList.add('modal-body');
    const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'modal-head' }, h('h2', {}, title), h('button', { class: 'round-btn', 'aria-label': 'Close', onclick: () => this.closeModal(box) }, img('close'))),
      tabs ?? null,
      body,
    );
    return box;
  }

  openStatus() {
    const g = this.g, s = g.save, n = s.pet.needs;
    const bar = (icon: string, label: string, v: number) => h('div', { class: 'need' }, img(icon, 'ic small'), h('span', {}, label), h('div', { class: 'need-bar' }, h('div', { style: `width:${Math.round(v * 100)}%;background:${v < 0.3 ? '#ff9a8a' : v < 0.6 ? '#ffd36b' : '#8fdc8a'}` })));
    const lvl = g.friendLevel;
    const next = FRIEND_LEVELS[lvl + 1];
    const moodText: Record<string, string> = { content: 'Feeling cozy and content', playful: 'Feeling playful!', sleepy: 'A little sleepy…', hungry: 'Tummy is rumbling', curious: 'Curious about everything', affectionate: 'Wants some cuddles', excited: 'SO EXCITED!', bored: 'A bit bored — let\'s play?', grumpy: 'A tiny bit huffy', mischievous: 'Up to something cheeky…' };
    const body = h('div', { class: 'status' },
      h('p', { class: 'mood' }, `${s.pet.name}: ${moodText[g.brain.mood]}`),
      bar('kibble', 'Tummy', n.hunger), bar('bed', 'Energy', n.energy), bar('bath', 'Clean', n.clean), bar('ball', 'Fun', n.fun), bar('heart', 'Love', n.affection),
      h('div', { class: 'friend-box' }, h('b', {}, FRIEND_LEVELS[lvl].name), next ? h('span', {}, ` · next: ${next.name}`) : h('span', {}, ' · the best friends ever!'),
        h('div', { class: 'need-bar pink' }, h('div', { style: this.ringStyle().replace('--p', 'width') }))),
      h('p', { class: 'panel-tip' }, 'Your pet shows how it feels — watch its face, ears and tail!'),
    );
    this.openModal(this.modalShell('How are they?', body));
  }

  openJournal(tab = 'about') {
    const g = this.g, s = g.save, m = s.memory;
    const tabsEl = h('div', { class: 'tabs', role: 'tablist' });
    const body = h('div', { class: 'journal' });
    const tabs: [string, string][] = [['about', 'About'], ['favs', 'Favorites'], ['tricks', 'Tricks'], ['treasure', 'Treasures'], ['memories', 'Memories']];
    const show = (t: string) => {
      tabsEl.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.t === t));
      body.innerHTML = '';
      if (t === 'about') {
        const cv = h('canvas', { width: '240', height: '240', class: 'portrait' }) as HTMLCanvasElement;
        const ctx = cv.getContext('2d')!;
        ctx.translate(120, 215); ctx.scale(1.05, 1.05);
        const p = defaultPose(); p.sit = 1; p.front = 1; p.smile = 1; p.blush = 0.7; p.eyeHappy = 1; p.tailUp = 0.8; p.time = 1; p.tailPhase = 1;
        drawPet(ctx, p, s.pet.appearance, s.equipped.wear, newRig());
        const days = Math.max(1, Math.ceil((Date.now() - s.createdAt) / 86400000));
        const traits = h('ul', { class: 'traits' });
        for (const k of ['energy', 'brave', 'cuddly', 'appetite', 'playful', 'curious'] as TraitId[]) {
          const rev = m.traitsRevealed.includes(k);
          traits.append(h('li', { class: rev ? '' : 'unknown' }, h('b', {}, g.traitTitle(k) + ': '), rev ? g.traitText(k) : '??? Keep playing to find out!'));
        }
        body.append(h('div', { class: 'about' }, cv, h('div', {},
          h('h3', { class: 'hand' }, s.pet.name),
          h('p', {}, `Came home: ${new Date(s.createdAt).toLocaleDateString()}`),
          h('p', {}, `Days together: ${days}`),
          h('p', {}, `Friendship: ${FRIEND_LEVELS[g.friendLevel].name}`),
        )), h('h4', {}, 'Personality'), traits);
      } else if (t === 'favs') {
        const fav = (label: string, icon: string | undefined, text: string | undefined) => h('div', { class: 'fav-card' + (text ? '' : ' unknown') }, icon ? img(icon) : h('span', { class: 'q' }, '?'), h('small', {}, label), h('b', {}, text ?? 'Not yet discovered'));
        body.append(h('div', { class: 'fav-grid' },
          fav('Favorite food', m.favFood, m.favFood ? foodDef(m.favFood).name : undefined),
          fav('Favorite toy', m.favToy, m.favToy ? toyDef(m.favToy).name : undefined),
          fav('Loves', m.favSpot ? 'heart' : undefined, m.favSpot ? SPOT_NAMES[m.favSpot as keyof typeof SPOT_NAMES] : undefined),
          fav('Not a fan of', m.dislikedFood, m.dislikedFood ? foodDef(m.dislikedFood).name : undefined),
        ));
        body.append(h('h4', {}, 'Foods tried'));
        const fg = h('div', { class: 'grid' });
        for (const f of FOODS) {
          const r = m.foods[f.id];
          const face = r ? { love: '♥♥♥', like: '♥♥', neutral: '♥', dislike: '😝' }[reactionFor(r.liking)] : '?';
          fg.append(h('div', { class: 'cell' + (r ? '' : ' unknown') }, img(f.id), h('small', {}, f.name), h('span', { class: 'rate' }, r ? face : 'not tried')));
        }
        body.append(fg, h('h4', {}, 'Toys played with'));
        const tg = h('div', { class: 'grid' });
        for (const t2 of TOYS) {
          const r = m.toys[t2.id];
          tg.append(h('div', { class: 'cell' + (r ? '' : ' unknown') }, img(t2.id), h('small', {}, t2.name), h('span', { class: 'rate' }, r ? `${r.plays}×` : '?')));
        }
        body.append(tg);
      } else if (t === 'tricks') {
        const list = h('div', { class: 'trick-list' });
        for (const tr of TRICKS) {
          const r = m.tricks[tr.id];
          const locked = g.friendLevel < tr.level;
          list.append(h('div', { class: 'trick-row' + (locked ? ' unknown' : '') }, img(tr.id === 'highfive' ? 'hand' : tr.id === 'sit' ? 'paw' : tr.id), h('b', {}, tr.name),
            h('div', { class: 'need-bar' }, h('div', { style: `width:${r.prof}%;background:${r.learned ? '#ffd23f' : '#9fd0ff'}` })),
            h('small', {}, locked ? `Unlocks at ${FRIEND_LEVELS[tr.level].name}` : r.learned ? `Learned! Performed ${r.performed}×` : `${Math.round(r.prof)}%`)));
        }
        body.append(list);
      } else if (t === 'treasure') {
        const grid = h('div', { class: 'grid' });
        for (const c of COLLECTIBLES) {
          const n = m.collect[c.id] ?? 0;
          grid.append(h('div', { class: 'cell' + (n ? '' : ' unknown') }, n ? img('c:' + c.id) : h('span', { class: 'q' }, '?'), h('small', {}, n ? c.name : '???'), n > 1 ? h('span', { class: 'rate' }, `×${n}`) : null));
        }
        body.append(h('p', { class: 'panel-tip' }, `${Object.keys(m.collect).length} / ${COLLECTIBLES.length} found — dig in the garden!`), grid);
      } else if (t === 'memories') {
        const list = h('div', { class: 'mem-list' });
        for (const e of [...m.journal].reverse()) {
          list.append(h('div', { class: 'mem' }, img(e.icon, 'ic small'), h('div', {}, h('small', {}, new Date(e.t).toLocaleDateString()), h('p', {}, e.text))));
        }
        if (!m.journal.length) list.append(h('p', {}, 'Your story is just beginning!'));
        body.append(list);
      }
    };
    for (const [id, label] of tabs) {
      const b = h('button', { class: 'tab', role: 'tab', onclick: () => { this.g.audio.click(); show(id); } }, label);
      (b as HTMLElement).dataset.t = id;
      tabsEl.append(b);
    }
    this.openModal(this.modalShell(`${s.pet.name}'s Memory Book`, body, tabsEl));
    show(tab);
  }

  openShop(tab = 'food') {
    const g = this.g, s = g.save;
    const tabsEl = h('div', { class: 'tabs', role: 'tablist' });
    const body = h('div', { class: 'shop' });
    const balance = h('div', { class: 'balance' }, img('twinkle', 'ic small'), h('span', {}, String(s.twinkles)), ' Twinkles');
    const buy = (price: number, then: () => void) => {
      if (s.twinkles < price) { g.audio.voice('hmm'); return; }
      s.twinkles -= price;
      then();
      g.audio.reward();
      g.persist();
      this.refresh();
    };
    const card = (icon: string, name: string, action: HTMLElement, sub = '') => h('div', { class: 'shop-card' }, img(icon), h('b', {}, name), sub ? h('small', {}, sub) : null, action);
    const priceBtn = (price: number, on: () => void) => h('button', { class: 'btn small primary', disabled: s.twinkles < price || undefined, onclick: on }, img('twinkle', 'ic tiny'), String(price));
    const show = (t: string) => {
      tabsEl.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.t === t));
      (balance.querySelector('span') as HTMLElement).textContent = String(s.twinkles);
      body.innerHTML = '';
      const grid = h('div', { class: 'shop-grid' });
      if (t === 'food') {
        for (const f of FOODS) {
          if (f.id === 'kibble') continue;
          grid.append(card(f.id, f.name, priceBtn(f.price, () => buy(f.price, () => { s.inventory.foods[f.id] = (s.inventory.foods[f.id] ?? 0) + f.pack; show(t); })), `×${f.pack} · have ${s.inventory.foods[f.id] ?? 0}`));
        }
      } else if (t === 'toys') {
        for (const toy of TOYS) {
          const owned = s.inventory.toys.includes(toy.id);
          grid.append(card(toy.id, toy.name, owned ? h('span', { class: 'owned' }, 'Owned ✓') : priceBtn(toy.price, () => buy(toy.price, () => { s.inventory.toys.push(toy.id); addJournal(s.memory, toy.id, `Got a new toy: ${toy.name}!`); g.world.cacheKey = ''; g.bump('newthings'); show(t); }))));
        }
      } else if (t === 'wear') {
        for (const w of WEARABLES) {
          const owned = s.inventory.wear.includes(w.id);
          const on = s.equipped.wear[w.slot] === w.id;
          const act = owned
            ? h('button', { class: 'btn small' + (on ? ' on' : ''), onclick: () => { if (on) delete s.equipped.wear[w.slot]; else s.equipped.wear[w.slot] = w.id; g.pet.jump(200); g.audio.voice('happy'); g.world.cacheKey = ''; show(t); } }, on ? 'Wearing ✓' : 'Wear')
            : priceBtn(w.price, () => buy(w.price, () => { s.inventory.wear.push(w.id); s.equipped.wear[w.slot] = w.id; g.pet.jump(250); g.world.cacheKey = ''; show(t); }));
          grid.append(card('w:' + w.id, w.name, act));
        }
      } else if (t === 'home') {
        for (const slot of DECOR_SLOTS) {
          grid.append(h('h4', { class: 'grid-head' }, slot.name));
          for (const d of DECOR.filter((x) => x.slot === slot.slot)) {
            const owned = s.inventory.decor.includes(d.id);
            const on = s.equipped.decor[d.slot] === d.id;
            const act = owned
              ? h('button', { class: 'btn small' + (on ? ' on' : ''), disabled: on || undefined, onclick: () => { s.equipped.decor[d.slot] = d.id; g.world.cacheKey = ''; g.noticeDecor(d.slot); show(t); } }, on ? 'Placed ✓' : 'Place')
              : priceBtn(d.price, () => buy(d.price, () => { s.inventory.decor.push(d.id); s.equipped.decor[d.slot] = d.id; g.world.cacheKey = ''; g.noticeDecor(d.slot); show(t); }));
            grid.append(card('d:' + d.id, d.name, act));
          }
        }
      }
      body.append(grid);
    };
    for (const [id, label] of [['food', 'Food'], ['toys', 'Toys'], ['wear', 'Wear'], ['home', 'Home']]) {
      const b = h('button', { class: 'tab', role: 'tab', onclick: () => { this.g.audio.click(); show(id); } }, label);
      (b as HTMLElement).dataset.t = id;
      tabsEl.append(b);
    }
    const shell = this.modalShell('Twinkle Shop', body, h('div', {}, balance, tabsEl));
    this.openModal(shell);
    show(tab);
  }

  openSettings() {
    const g = this.g, st = g.save.settings;
    const slider = (label: string, icon: string, v: number, on: (v: number) => void) => {
      const input = h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(v), 'aria-label': label }) as HTMLInputElement;
      input.addEventListener('input', () => on(parseFloat(input.value)));
      return h('label', { class: 'set-row' }, img(icon, 'ic small'), h('span', {}, label), input);
    };
    const toggle = (label: string, v: boolean, on: (v: boolean) => void) => {
      const input = h('input', { type: 'checkbox' }) as HTMLInputElement;
      input.checked = v;
      input.addEventListener('change', () => on(input.checked));
      return h('label', { class: 'set-row toggle' }, h('span', {}, label), input, h('i', { class: 'switch' }));
    };
    const body = h('div', { class: 'settings' },
      slider('Music', 'music', st.music, (v) => { st.music = v; g.applySettings(); }),
      slider('Sounds', 'sound', st.sfx, (v) => { st.sfx = v; g.applySettings(); g.audio.click(); }),
      toggle('Reduce motion', st.reducedMotion, (v) => { st.reducedMotion = v; g.applySettings(); }),
      toggle('High contrast', st.highContrast, (v) => { st.highContrast = v; g.applySettings(); }),
      toggle('Bigger text', st.largeText, (v) => { st.largeText = v; g.applySettings(); }),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => { g.persist(); this.closeModal(); this.showTitle(); } }, 'Title screen'),
        h('button', { class: 'btn danger-ghost', onclick: () => this.confirmReset(false) }, 'Reset save…'),
      ),
      h('p', { class: 'panel-tip' }, 'Your pet is saved automatically on this device.'),
    );
    this.openModal(this.modalShell('Settings', body));
  }
}
