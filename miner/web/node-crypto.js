/**
 * `node:crypto` for the browser build — the miner asks it for one thing, md5 of a wiki file name.
 *
 * `crypto.subtle` cannot help: WebCrypto ships SHA-1/256/384/512 and deliberately no md5. MediaWiki
 * files live at `/images/<h0>/<h0h1>/<name>.png` with `h` the md5 of the name, so md5 it must be —
 * see `md5.js`, which `test/md5.test.js` holds against node's own.
 */
import { md5 } from './md5.js';

export function createHash(algorithm) {
  if (algorithm !== 'md5') throw new Error(`node-crypto shim: ${algorithm} is not implemented`);
  let data = '';
  return {
    update(chunk) {
      data += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      return this;
    },
    digest(enc) {
      if (enc !== 'hex') throw new Error(`node-crypto shim: ${enc} digest is not implemented`);
      return md5(data);
    },
  };
}

export default { createHash };
