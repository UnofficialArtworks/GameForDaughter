import { describe, it, expect } from 'vitest';
import { ShortTerm, RequestPacer, growHabit, fadeHabits, habit, HABIT_NOTICE } from '../src/pet/context';
import { emptyMemory, migrate, newSave, randomAppearance } from '../src/state';

describe('short-term memory', () => {
  it('knows how long ago things happened and how often', () => {
    const st = new ShortTerm();
    expect(st.ago('fed')).toBe(Infinity);
    st.now = 10; st.mark('fetch', 'ball');
    st.now = 20; st.mark('fetch', 'squeaky');
    st.now = 100; st.mark('fed', 'apple');
    st.now = 130;
    expect(st.ago('fed')).toBe(30);
    expect(st.within('fed', 60)).toBe(true);
    expect(st.count('fetch', 200)).toBe(2);
    expect(st.count('fetch', 115)).toBe(1);
    expect(st.detail('fetch')).toBe('squeaky');
  });
});

describe('habits', () => {
  it('grow with diminishing returns and announce themselves once', () => {
    const m = emptyMemory();
    let notices = 0;
    for (let i = 0; i < 40; i++) if (growHabit(m, 'fetch', 0.05)) notices++;
    expect(notices).toBe(1);
    expect(habit(m, 'fetch')).toBeGreaterThan(HABIT_NOTICE);
    expect(habit(m, 'fetch')).toBeLessThan(1);
  });

  it('fade gently over days, never all at once', () => {
    const m = emptyMemory();
    m.habits.garden = 0.8;
    fadeHabits(m, 1);
    expect(m.habits.garden).toBeCloseTo(0.8 * 0.97, 5);
    fadeHabits(m, 1000); // capped
    expect(m.habits.garden).toBeGreaterThan(0.1);
  });

  it('older saves without habits load with an empty habit set', () => {
    const s: any = newSave('Pip', randomAppearance());
    delete s.memory.habits;
    const m = migrate(JSON.parse(JSON.stringify(s)))!;
    expect(m.memory.habits).toEqual({});
    expect(habit(m.memory, 'fetch')).toBe(0);
  });
});

describe('request pacing', () => {
  it('keeps a quiet gap between requests and leaves ignored wishes alone for a while', () => {
    const p = new RequestPacer();
    expect(p.can('heart', 0)).toBe(true);
    p.asked(0);
    expect(p.can('ball', 20, 45)).toBe(false); // too soon after any request
    expect(p.can('ball', 50, 45)).toBe(true);
    p.expired('heart', 50); // ignored — no penalty, just patience
    expect(p.can('heart', 120, 45, 150)).toBe(false);
    expect(p.can('heart', 210, 45, 150)).toBe(true);
    p.expired('kibble', 0); p.fulfilled('kibble');
    expect(p.can('kibble', 100, 45)).toBe(true);
  });
});
