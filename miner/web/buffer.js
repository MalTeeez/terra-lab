/**
 * The slice of node's `Buffer` the miner actually uses, over a plain `Uint8Array`.
 *
 * The CLR reader (`clr/`), the `.tmod` container and the IL interpreter all read their bytes
 * through Buffer's little-endian accessors, at a few million calls per mine. Rather than rewrite
 * 69 call sites for the browser, the mining worker installs this as `globalThis.Buffer` and every
 * one of them keeps working — `subarray` on a `Uint8Array` subclass returns the subclass, so a
 * slice stays a Buffer all the way down.
 *
 * The integer reads are byte arithmetic (what node does too) rather than a `DataView` per call,
 * which would allocate one on the hottest path in the miner. Only the float and 64-bit reads —
 * rare, a handful of constants per assembly — go through a shared scratch view.
 */
const scratch = new DataView(new ArrayBuffer(8));
const utf8 = new TextDecoder();
const utf16 = new TextDecoder('utf-16le');

/** ISO-8859-1, byte for code point — `TextDecoder('latin1')` is windows-1252, which is not the same. */
function latin1(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return s;
}

export class WebBuffer extends Uint8Array {
  static from(src, enc) {
    if (typeof src === 'string') return new WebBuffer(new TextEncoder().encode(src).buffer);
    if (src instanceof ArrayBuffer) return new WebBuffer(src); // node wraps rather than copies, and so do we
    const out = new WebBuffer(src.length);
    out.set(src);
    return out;
  }
  static alloc(n, fill = 0) {
    const out = new WebBuffer(n);
    if (fill) out.fill(fill);
    return out;
  }
  static concat(list) {
    const out = new WebBuffer(list.reduce((n, b) => n + b.length, 0));
    let at = 0;
    for (const b of list) { out.set(b, at); at += b.length; }
    return out;
  }

  readUInt8(o = 0) { return this[o]; }
  readInt8(o = 0) { return (this[o] << 24) >> 24; }
  readUInt16LE(o = 0) { return this[o] | (this[o + 1] << 8); }
  readInt16LE(o = 0) { return ((this[o] | (this[o + 1] << 8)) << 16) >> 16; }
  readUInt32LE(o = 0) { return (this[o] | (this[o + 1] << 8) | (this[o + 2] << 16)) + this[o + 3] * 0x1000000; }
  readInt32LE(o = 0) { return this[o] | (this[o + 1] << 8) | (this[o + 2] << 16) | (this[o + 3] << 24); }
  readFloatLE(o = 0) { return this.#scratch(o, 4).getFloat32(0, true); }
  readDoubleLE(o = 0) { return this.#scratch(o, 8).getFloat64(0, true); }
  readBigInt64LE(o = 0) { return this.#scratch(o, 8).getBigInt64(0, true); }
  readBigUInt64LE(o = 0) { return this.#scratch(o, 8).getBigUint64(0, true); }

  #scratch(o, n) {
    for (let i = 0; i < n; i++) scratch.setUint8(i, this[o + i]);
    return scratch;
  }

  toString(enc = 'utf8', start = 0, end = this.length) {
    const bytes = this.subarray(start, end);
    if (enc === 'latin1' || enc === 'binary' || enc === 'ascii') return latin1(bytes);
    if (enc === 'utf16le' || enc === 'ucs2') return utf16.decode(bytes);
    return utf8.decode(bytes);
  }
}
