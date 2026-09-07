/**
 * The browser miner's `.tmod` repack, checked in Node against the real files: same entry bytes as
 * `readTmod` gives, and the result is still a `.tmod` the miner can read.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { defaultPaths, resolveMods } from '../miner/resolve.js';
import { readTmod } from '../miner/tmod.js';
import { entryStarts, needed, unpackTmod } from '../miner/web/tmodpack.js';

const paths = defaultPaths();
const mod = resolveMods(['CalamityMod'], paths).resolved[0];
const it = (cond) => (cond ? test : test.skip);
const has = !!mod && existsSync(mod.path);

describe('tmodpack', () => {
  it(has)('derives the offset of every entry', () => {
    const bytes = readFileSync(mod.path);
    const tmod = readTmod(bytes);
    const starts = entryStarts(tmod);
    // the first entry starts right after the header, the last one ends at the end of the file
    const last = [...tmod.entries].at(-1);
    expect(starts.get(last[0]) + last[1].compressedLength).toBe(bytes.length);
    // and a compressed entry inflates from where it says it does
    for (const [path, e] of tmod.entries) {
      if (!needed(tmod.name)(path)) continue;
      expect(bytes.subarray(starts.get(path), starts.get(path) + e.compressedLength).length).toBe(e.compressedLength);
    }
  });

  it(has)('repacks the entries the miner reads, byte for byte', async () => {
    const bytes = readFileSync(mod.path);
    const before = readTmod(bytes);
    const after = readTmod(await unpackTmod(bytes));

    expect(after.name).toBe(before.name);
    expect(after.version).toBe(before.version);
    expect(after.tmlVersion).toBe(before.tmlVersion);

    const kept = [...before.entries.keys()].filter(needed(before.name));
    expect(kept.length).toBeGreaterThan(1);
    expect([...after.entries.keys()]).toEqual(kept);
    for (const path of kept) {
      expect(after.entries.get(path).read()).toEqual(before.entries.get(path).read());
    }
  });
});
