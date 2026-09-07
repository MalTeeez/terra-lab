/**
 * Unpack a `.tmod` into a `.tmod` the miner can read synchronously.
 *
 * `readTmod` inflates an entry on demand with `inflateRawSync`, and the browser has no synchronous
 * inflate — `DecompressionStream` is a stream. So before the mine starts, each picked file is read
 * here, the handful of entries the miner actually opens are inflated asynchronously, and a fresh
 * `.tmod` is written with those entries *stored* (compressedLength === length). `readTmod` then
 * takes the short branch and never reaches zlib.
 *
 * Dropping the rest is the point as much as the inflating is: a mod's sprites and audio are most of
 * its file and none of its data, so this is also what keeps a 200 MB pack inside a browser tab.
 */
import { encodeString, readTmod } from '../tmod.js';

/**
 * The entries the miner opens: the mod's assembly (mine.js), its en-US localization
 * (extract/localization.js) and any PackBuilder edits (extract/packbuilder.js).
 */
export const needed = (name) => (path) =>
  path === `${name}.dll`
  || (/^Localization\//i.test(path) && /\.hjson$/i.test(path))
  || /\.(itemmod|recipemod)\.json$/i.test(path);

/**
 * Where each entry's bytes start, derived from the same values `readTmod` parsed rather than by
 * walking the file again: the header is fixed-size but for the strings in it, and `encodeString` is
 * how those were written.
 */
export function entryStarts(tmod) {
  const len = (s) => encodeString(s).length;
  let off = 4 + len(tmod.tmlVersion) + 20 + 256 + 4; // magic, tML version, hash, signature, data length
  off += len(tmod.name) + len(tmod.version) + 4; // name, version, entry count
  for (const path of tmod.entries.keys()) off += len(path) + 8; // path, length, compressedLength
  const starts = new Map();
  for (const [path, e] of tmod.entries) {
    starts.set(path, off);
    off += e.compressedLength;
  }
  return starts;
}

const i32 = (n) => {
  const b = Buffer.alloc(4);
  new DataView(b.buffer, b.byteOffset, 4).setInt32(0, n, true);
  return b;
};

/** Rebuild a `.tmod` around already-inflated entries. */
export function packTmod({ tmlVersion, name, version }, entries) {
  const data = Buffer.concat([
    encodeString(name),
    encodeString(version),
    i32(entries.length),
    ...entries.map(([path, bytes]) => Buffer.concat([encodeString(path), i32(bytes.length), i32(bytes.length)])),
    ...entries.map(([, bytes]) => bytes),
  ]);
  return Buffer.concat([
    Buffer.from('TMOD', 'latin1'),
    encodeString(tmlVersion),
    Buffer.alloc(20), // hash and signature are read past, never checked
    Buffer.alloc(256),
    i32(data.length),
    data,
  ]);
}

async function inflateRaw(raw) {
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return Buffer.from(await new Response(stream).arrayBuffer());
}

/** @param {Buffer} bytes a `.tmod` as it came off disk @returns {Promise<Buffer>} a stored-entry one */
export async function unpackTmod(bytes, keep = needed) {
  const tmod = readTmod(bytes);
  const starts = entryStarts(tmod);
  const wanted = keep(tmod.name);
  const out = [];
  for (const [path, e] of tmod.entries) {
    if (!wanted(path)) continue;
    const raw = bytes.subarray(starts.get(path), starts.get(path) + e.compressedLength);
    out.push([path, e.compressedLength === e.length ? raw : await inflateRaw(raw)]);
  }
  if (!out.length) throw new Error(`${tmod.name}: nothing to mine in this .tmod`);
  return packTmod(tmod, out);
}
