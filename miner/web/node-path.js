/**
 * `node:path` for the browser build. The miner only ever joins and splits the paths it was handed,
 * and in here they are all forward-slashed keys into `vfs.js`.
 */
export const join = (...parts) => parts.filter(Boolean).join('/').replace(/\/{2,}/g, '/');
export const dirname = (p) => String(p).replace(/\/[^/]*$/, '') || '/';
export const basename = (p) => String(p).split('/').pop();
export const resolve = (...parts) => {
  const joined = join(...parts);
  return joined.startsWith('/') ? joined : `/${joined}`;
};
export const extname = (p) => (String(p).match(/\.[^./]*$/) ?? [''])[0];

export default { join, dirname, basename, resolve, extname };
