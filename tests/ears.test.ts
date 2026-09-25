import { describe, it, expect } from 'vitest';
import { defaultPose, floppyEars } from '../src/pet/render';

const R = 54;
// distance from the head centre in "head radii" (the head blob is R wide and 0.94R tall)
const radius = (x: number, y: number) => Math.hypot(x, y / 0.94) / R;

describe('floppy ears', () => {
  it('stay rooted on the skull in every view, mood, tilt and swing', () => {
    for (const hf of [0, 0.25, 0.5, 0.75, 1]) for (const perk of [-1, 0, 1]) for (const tilt of [-0.45, 0, 0.45]) for (const sw of [-0.5, 0, 0.5]) {
      const p = { ...defaultPose(), earPerk: perk, earL: sw, earR: -sw, earTipL: -1.2 * Math.abs(sw), earTipR: 1.2 * Math.abs(sw) };
      for (const e of floppyEars(p, R, hf, tilt)) {
        expect(radius(e.rx, e.ry)).toBeLessThan(0.95); // the root sits on the head, never floating off it
        expect(radius(e.jx, e.jy)).toBeLessThan(1.25); // the fold stays at the edge of the skull
        expect(Math.hypot(e.tx - e.jx, e.ty - e.jy) / R).toBeCloseTo(0.62, 5); // the flap never stretches
      }
    }
  });

  it('layers correctly: in 3/4 view the near ear is over the face and the far one behind the head', () => {
    const [left, right] = floppyEars(defaultPose(), R, 0, 0);
    expect(left.front).toBe(true);
    expect(right.front).toBe(false);
    // at rest the near ear hangs at the back of the head, well clear of the eyes (which sit at x ≥ 0)
    expect(left.tx / R).toBeLessThan(-0.4);
    expect(left.jx / R).toBeLessThan(-0.4);
    // facing us, both ears frame the face from in front
    expect(floppyEars(defaultPose(), R, 1, 0).every((e) => e.front)).toBe(true);
  });
});
