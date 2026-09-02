/**
 * `.tmod` container reader.
 *
 * Layout (tModLoader 1.4, `TmodFile.Read`):
 *   "TMOD"                      magic
 *   string  tModLoader version  7-bit length-prefixed UTF-8
 *   byte[20] hash
 *   byte[256] signature
 *   uint32  data length
 *   -- data --
 *   string  mod name
 *   string  mod version
 *   int32   entry count
 *   entries: string path, int32 length, int32 compressedLength
 *   blobs, in entry order; raw-deflate when compressedLength != length
 */
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const MAGIC = 'TMOD';

class Cursor {
  constructor(buf, pos = 0) {
    this.buf = buf;
    this.pos = pos;
  }
  bytes(n) {
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  u32() {
    const v = this.buf.readUInt32LE(this.pos);
    this.pos += 4;
    return v;
  }
  i32() {
    const v = this.buf.readInt32LE(this.pos);
    this.pos += 4;
    return v;
  }
  /** .NET BinaryReader.ReadString: 7-bit encoded byte length, then UTF-8. */
  string() {
    let len = 0;
    let shift = 0;
    for (;;) {
      const b = this.buf[this.pos++];
      len |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    return this.bytes(len).toString('utf8');
  }
}

/** Encode a string the way BinaryWriter.Write(string) does — used by tests and fixtures. */
export function encodeString(s) {
  const body = Buffer.from(s, 'utf8');
  const len = [];
  let n = body.length;
  do {
    let b = n & 0x7f;
    n >>= 7;
    if (n) b |= 0x80;
    len.push(b);
  } while (n);
  return Buffer.concat([Buffer.from(len), body]);
}

/**
 * @param {Buffer} buf
 * @returns {{ tmlVersion: string, name: string, version: string, entries: Map<string, { length: number, compressedLength: number, read: () => Buffer }> }}
 */
export function readTmod(buf) {
  const c = new Cursor(buf);
  if (c.bytes(4).toString('latin1') !== MAGIC) throw new Error('Not a .tmod file (bad magic)');
  const tmlVersion = c.string();
  c.bytes(20); // hash
  c.bytes(256); // signature
  const dataLength = c.u32();
  const dataStart = c.pos;
  if (dataStart + dataLength > buf.length) throw new Error('Truncated .tmod (data length exceeds file)');

  const name = c.string();
  const version = c.string();
  const count = c.i32();
  const headers = [];
  for (let i = 0; i < count; i++) {
    headers.push({ path: c.string(), length: c.i32(), compressedLength: c.i32() });
  }

  const entries = new Map();
  let offset = c.pos;
  for (const h of headers) {
    const start = offset;
    const { length, compressedLength } = h;
    entries.set(h.path, {
      length,
      compressedLength,
      read: () => {
        const raw = buf.subarray(start, start + compressedLength);
        return compressedLength === length ? Buffer.from(raw) : inflateRawSync(raw);
      },
    });
    offset += compressedLength;
  }
  return { tmlVersion, name, version, entries };
}

export function readTmodFile(path) {
  return readTmod(readFileSync(path));
}
