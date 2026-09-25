import { describe, it, expect } from 'vitest';
import { emptyWalkMem, recordStop, pickKinds, pickChoice, kindWeight, PATHS, WALK_KINDS } from '../src/walkmem';
import { migrate, newSave, randomAppearance, type Traits } from '../src/state';
import { seeded } from '../src/util';

const avg: Traits = { energy: 0.5, brave: 0.5, cuddly: 0.5, appetite: 0.5, playful: 0.5, curious: 0.5 };

describe('favourite walk spot', () => {
  it('never appears on the first walks, then emerges from repeated happy visits', () => {
    const w = emptyWalkMem();
    // first two walks: lots of fun at the pond, but it's too early to call it a favourite
    for (let walk = 0; walk < 2; walk++) { expect(recordStop(w, 'puddle', 1.4)).toBe(false); w.walks++; }
    let fav = false;
    for (let walk = 0; walk < 3 && !fav; walk++) { recordStop(w, 'flowers', 0.6); fav = recordStop(w, 'puddle', 1.4); w.walks++; }
    expect(fav).toBe(true);
    expect(w.fav).toBe('puddle');
  });

  it('needs enjoyment, not just visits, and is not replaced lightly', () => {
    const w = emptyWalkMem(); w.walks = 5;
    for (let i = 0; i < 6; i++) recordStop(w, 'bench', 0.3); // visited a lot, never loved
    expect(w.fav).toBe('');
    for (let i = 0; i < 4; i++) recordStop(w, 'leaves', 1.3);
    expect(w.fav).toBe('leaves');
    recordStop(w, 'dig', 1.5); recordStop(w, 'dig', 1.5); recordStop(w, 'dig', 1.5);
    expect(w.fav).toBe('leaves'); // a close runner-up doesn't steal it
  });
});

describe('route planning', () => {
  it('picks distinct stops and two different paths with something new', () => {
    const rng = seeded(7), w = emptyWalkMem();
    for (let i = 0; i < 50; i++) {
      const first = pickKinds(2, avg, w, false, [], rng);
      expect(new Set(first).size).toBe(2);
      const [a, b] = pickChoice(avg, w, false, first, rng);
      expect(a).not.toBe(b);
      for (const t of [a, b]) expect(PATHS[t].kinds.some((k) => !first.includes(k))).toBe(true);
    }
  });

  it('personality and the favourite spot tilt the odds', () => {
    const w = emptyWalkMem();
    const foodie = { ...avg, appetite: 0.95 }, picky = { ...avg, appetite: 0.1 };
    expect(kindWeight('picnic', foodie, w, false)).toBeGreaterThan(kindWeight('picnic', picky, w, false) * 2);
    const lazy = { ...avg, energy: 0.1 }, zoomy = { ...avg, energy: 0.95 };
    expect(kindWeight('leaves', zoomy, w, false)).toBeGreaterThan(kindWeight('leaves', lazy, w, false));
    expect(kindWeight('bench', lazy, w, false)).toBeGreaterThan(kindWeight('bench', zoomy, w, false));
    const before = kindWeight('puddle', avg, w, false);
    w.fav = 'puddle';
    expect(kindWeight('puddle', avg, w, false)).toBeCloseTo(before * 2.5, 5);
    // a favourite shows up far more often across many walks
    const rng = seeded(3); let n = 0;
    for (let i = 0; i < 400; i++) if (pickKinds(2, avg, w, false, [], rng).includes('puddle')) n++;
    expect(n / 400).toBeGreaterThan(2 / WALK_KINDS.length * 1.5);
  });
});

describe('save compatibility', () => {
  it('older saves without walk memory load with safe defaults', () => {
    const s: any = newSave('Pip', randomAppearance());
    delete s.memory.walk;
    s.memory.collect = { acorn: 2 };
    const m = migrate(JSON.parse(JSON.stringify(s)))!;
    expect(m.memory.walk).toEqual(emptyWalkMem());
    expect(m.memory.collect.acorn).toBe(2);
  });
  it('a partially-written walk memory is filled in', () => {
    const s: any = newSave('Pip', randomAppearance());
    s.memory.walk = { walks: 4, joy: { puddle: 5 } };
    const m = migrate(JSON.parse(JSON.stringify(s)))!;
    expect(m.memory.walk.walks).toBe(4);
    expect(m.memory.walk.joy.puddle).toBe(5);
    expect(m.memory.walk.visits).toEqual({});
    expect(m.memory.walk.fav).toBe('');
    expect(m.memory.walk.sticks).toBe(0);
  });
});
