/**
 * `node:fs` for the browser build — every call the miner makes, answered from `vfs.js`.
 * Aliased in vite.config.js; `bun run mine` never sees this file.
 */
import { vfs } from './vfs.js';

/** A small data file the bundler inlined into the code that reads it, rather than emitting it. */
const inlined = (p) => {
  const s = String(p?.href ?? p);
  if (!s.startsWith('data:')) return undefined;
  const [head, body] = [s.slice(0, s.indexOf(',')), s.slice(s.indexOf(',') + 1)];
  return Buffer.from(head.endsWith(';base64') ? Uint8Array.from(atob(body), (c) => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(body)));
};

export const existsSync = (p) => inlined(p) !== undefined || vfs.has(p);
export const readFileSync = (p, enc) => {
  const bytes = inlined(p) ?? vfs.get(p);
  if (bytes === undefined) throw Object.assign(new Error(`ENOENT: no such file, open '${p}'`), { code: 'ENOENT' });
  return enc ? bytes.toString(enc === 'utf8' || enc === 'utf-8' ? 'utf8' : enc) : bytes;
};
export const writeFileSync = (p, data) => vfs.set(p, typeof data === 'string' ? Buffer.from(data, 'utf8') : data);
export const mkdirSync = () => undefined;
/** Only the mod-config and workshop scans, and neither directory exists in here. */
export const readdirSync = () => [];
export const statSync = () => ({ isDirectory: () => false });

export default { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync };
