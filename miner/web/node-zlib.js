/**
 * `node:zlib` for the browser build. Nothing calls it: the worker hands the miner `.tmod` files
 * whose entries are already stored uncompressed (see tmodpack.js), because the browser's only
 * inflate — `DecompressionStream` — is asynchronous and `readTmod` reads entries synchronously.
 * If a compressed entry ever does reach here, say so rather than return something wrong.
 */
export function inflateRawSync() {
  throw new Error('node-zlib shim: the browser cannot inflate synchronously — the .tmod should have been unpacked first');
}

export default { inflateRawSync };
