/**
 * MD5, because MediaWiki's image path is `/images/<h0>/<h0h1>/<File_name>.png` with `h` the md5 of
 * the file name — and `crypto.subtle` has no md5 (rightly: it is a hash function here, not a
 * security one). Short UTF-8 strings only, which is all a file name is.
 *
 * RFC 1321, the usual 64-round form. `test/md5.test.js` checks it against node's own.
 */
const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32));
const rotl = (x, c) => (x << c) | (x >>> (32 - c));

/** @param {string} text @returns {string} lowercase hex digest */
export function md5(text) {
  const body = new TextEncoder().encode(text);
  // message + 0x80 + zero padding to 56 mod 64 + the bit length as a 64-bit LE integer
  const blocks = Math.ceil((body.length + 9) / 64);
  const buf = new Uint8Array(blocks * 64);
  buf.set(body);
  buf[body.length] = 0x80;
  new DataView(buf.buffer).setUint32(buf.length - 8, body.length * 8, true); // < 512 MB of name, so the high word stays 0

  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  const m = new Uint32Array(16);
  const view = new DataView(buf.buffer);
  for (let off = 0; off < buf.length; off += 64) {
    for (let i = 0; i < 16; i++) m[i] = view.getUint32(off + i * 4, true);
    let [a, b, c, d] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i++) {
      let f;
      let g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      f = (f + a + K[i] + m[g]) | 0;
      a = d;
      d = c;
      c = b;
      b = (b + rotl(f, S[i])) | 0;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }
  let hex = '';
  for (const word of [a0, b0, c0, d0]) {
    for (let i = 0; i < 4; i++) hex += ((word >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
  }
  return hex;
}
