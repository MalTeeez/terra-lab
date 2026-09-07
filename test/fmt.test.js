import { describe, expect, test } from 'bun:test';
import { fmtSpeed } from '../src/lib/fmt.js';

describe('fmtSpeed', () => {
  test('grades an animation the way vanilla does, on its boundaries', () => {
    expect(fmtSpeed(8)).toBe('Insanely fast');
    expect(fmtSpeed(9)).toBe('Very fast');
    expect(fmtSpeed(20)).toBe('Very fast');
    expect(fmtSpeed(25)).toBe('Fast');
    expect(fmtSpeed(30)).toBe('Average');
    expect(fmtSpeed(35)).toBe('Slow');
    expect(fmtSpeed(45)).toBe('Very slow');
    expect(fmtSpeed(55)).toBe('Extremely slow');
    expect(fmtSpeed(56)).toBe('Snail');
    expect(fmtSpeed(undefined)).toBe('');
  });
});
