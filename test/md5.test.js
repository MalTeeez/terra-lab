import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { md5 } from '../miner/web/md5.js';

const node = (s) => createHash('md5').update(s, 'utf8').digest('hex');

describe('md5', () => {
  test('matches node for the strings the miner hashes', () => {
    // wiki file names: the empty string, block boundaries, a name with a non-ASCII character
    for (const s of ['', 'abc', 'Murasama.png', 'Auric_Tesla_Breastplate.png', 'Elemental_Helmet_(Secrets_Of_The_Shadows).png',
      'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(57), 'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(65), 'Röntgen_Blade.png']) {
      expect(md5(s)).toBe(node(s));
    }
  });
});
