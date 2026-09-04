import { describe, expect, test } from 'bun:test';
import { loopCount, loopTracker } from '../miner/extract/projectiles.js';

/**
 * How many projectiles a burst fires is read off the backward compare that closes the loop. That
 * compare says where the counter is and where it stops, but not how far it moves each pass — and a
 * fan that steps in degrees moves several at a time.
 */
describe('loopTracker', () => {
  // `for (i = -5; i <= 5; i += 5)` — Scourge of the Desert's three-javelin stealth strike. The
  // interpreter reaches the compare having run the body once, so it sees i = 0 against a bound of 5.
  const scourge = () => {
    const t = loopTracker();
    t.onStoreLocal(0, 5, { offset: 14 });   // the step, hoisted into a local
    t.onStoreLocal(1, -5, { offset: 17 });  // i = -step, before the loop
    t.onStoreLocal(1, 0, { offset: 126 });  // i += step, at the bottom of the body
    return t;
  };

  test('recovers the step, so a fan that moves 5 at a time is not eleven projectiles', () => {
    expect(scourge().count({ operand: 20, offset: 129 }, 0, 5, 'ble')).toBe(3);
    // what it used to answer, from the same compare, by assuming the counter moved by one
    expect(loopCount(0, 5, 'ble')).toBe(7);
  });

  test('counts down as readily as up', () => {
    // `for (i = 5; i >= 0; i -= 1)`
    const t = loopTracker();
    t.onStoreLocal(0, 5, { offset: 5 });
    t.onStoreLocal(0, 4, { offset: 40 });
    expect(t.count({ operand: 10, offset: 45 }, 4, 0, 'bge')).toBe(6);
  });

  test('falls back to the old reading when the counter cannot be traced', () => {
    const t = loopTracker();
    // no store before the loop: nothing says where the counter started
    t.onStoreLocal(0, 3, { offset: 40 });
    expect(t.count({ operand: 10, offset: 45 }, 3, 8, 'blt')).toBe(loopCount(3, 8, 'blt'));
    // a symbolic bound is not a count either
    expect(t.count({ operand: 10, offset: 45 }, 3, { k: 'flag' }, 'blt')).toBe(loopCount(3, { k: 'flag' }, 'blt'));
  });
});
