import { describe, expect, test } from 'bun:test';
import { deflateRawSync } from 'node:zlib';
import { encodeString, readTmod } from '../miner/tmod.js';

function buildTmod({ tml = '2026.6.3.4', name = 'TestMod', version = '1.2.3', files }) {
  const headers = [];
  const blobs = [];
  for (const [path, content, compress] of files) {
    const raw = Buffer.from(content, 'utf8');
    const blob = compress ? deflateRawSync(raw) : raw;
    headers.push(Buffer.concat([encodeString(path), int32(raw.length), int32(blob.length)]));
    blobs.push(blob);
  }
  const data = Buffer.concat([
    encodeString(name),
    encodeString(version),
    int32(files.length),
    ...headers,
    ...blobs,
  ]);
  return Buffer.concat([
    Buffer.from('TMOD', 'latin1'),
    encodeString(tml),
    Buffer.alloc(20, 1),
    Buffer.alloc(256, 2),
    int32(data.length),
    data,
  ]);
}

function int32(n) {
  const b = Buffer.alloc(4);
  b.writeInt32LE(n);
  return b;
}

describe('readTmod', () => {
  test('reads header strings and both stored and deflated entries', () => {
    const buf = buildTmod({
      files: [
        ['TestMod.dll', 'MZ-not-really-a-dll', false],
        ['Localization/en-US_Mods.TestMod.hjson', 'Mods: { TestMod: { Items: {} } }', true],
      ],
    });
    const mod = readTmod(buf);
    expect(mod.tmlVersion).toBe('2026.6.3.4');
    expect(mod.name).toBe('TestMod');
    expect(mod.version).toBe('1.2.3');
    expect([...mod.entries.keys()]).toEqual(['TestMod.dll', 'Localization/en-US_Mods.TestMod.hjson']);
    expect(mod.entries.get('TestMod.dll').read().toString()).toBe('MZ-not-really-a-dll');
    expect(mod.entries.get('Localization/en-US_Mods.TestMod.hjson').read().toString()).toBe(
      'Mods: { TestMod: { Items: {} } }',
    );
  });

  test('rejects a non-tmod buffer', () => {
    expect(() => readTmod(Buffer.from('PKjunk'))).toThrow(/magic/);
  });

  test('7-bit length prefix handles strings longer than 127 bytes', () => {
    const long = 'x'.repeat(300);
    const buf = buildTmod({ files: [[long, 'c', false]] });
    expect([...readTmod(buf).entries.keys()][0]).toBe(long);
  });
});
