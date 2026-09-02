/**
 * Mod config values: the player's `ModConfigs/<Mod>_<Class>.json`, falling back to the
 * `[DefaultValue(...)]` attributes on the config class. Balancing mods gate their changes
 * on these, so resolving them decides which branches the interpreter takes.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { T } from './clr/metadata.js';
import { UNKNOWN } from './extract/interp.js';
import { derivesFromTml } from './extract/util.js';

/** @returns {Map<string, object>} "Mod_Class" → parsed JSON */
export function loadModConfigs(savesDir) {
  const out = new Map();
  const dir = join(savesDir, 'ModConfigs');
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      out.set(f.slice(0, -5), JSON.parse(readFileSync(join(dir, f), 'utf8')));
    } catch { /* unreadable config */ }
  }
  return out;
}

const isConfigType = (asm, td) => derivesFromTml(asm, td, 'ModConfig');

/** `[DefaultValue(x)]` on a field or property of `td`, or undefined. */
function defaultValue(asm, td, member) {
  const tokens = [];
  const f = td.fields.find((x) => x.name === member || x.name === `<${member}>k__BackingField`);
  if (f) tokens.push(f.token);
  const p = asm.propsByType.get(td.rid)?.find((x) => x.name === member);
  if (p) tokens.push(((T.Property << 24) | p.rid) >>> 0);
  for (const tok of tokens) {
    for (const a of asm.attributes(tok)) {
      if (a.name !== 'DefaultValueAttribute') continue;
      try {
        const { fixed } = asm.attributeArgs(a);
        if (fixed.length === 1 && (typeof fixed[0] === 'number' || typeof fixed[0] === 'boolean')) return fixed[0] === true ? 1 : fixed[0] === false ? 0 : fixed[0];
      } catch { /* unreadable */ }
    }
  }
  return undefined;
}

/**
 * Hooks that make config reads resolve to concrete values.
 * `ModContent.GetInstance<Cfg>()` / `Cfg.Instance` → { k:'config' }, then `get_X` / `ldfld X`.
 */
export function configHooks(asm, modId, configs) {
  const cache = new Map();
  const value = (td, member) => {
    const key = `${td.name}.${member}`;
    if (cache.has(key)) return cache.get(key);
    let v;
    const json = configs.get(`${modId}_${td.name}`);
    if (json && member in json) {
      const raw = json[member];
      v = typeof raw === 'boolean' ? (raw ? 1 : 0) : typeof raw === 'number' ? raw : UNKNOWN;
    } else {
      const d = defaultValue(asm, td, member);
      v = d === undefined ? UNKNOWN : d;
    }
    cache.set(key, v);
    return v;
  };
  return {
    onStaticLoad(field) {
      const td = field.declaringType?.def;
      if (td && field.name === 'Instance' && isConfigType(asm, td)) return { k: 'config', td };
      return undefined;
    },
    onCall(callee, args, ctx) {
      if (callee.kind === 'methodSpec' && callee.name === 'GetInstance' && callee.declaringType?.fullName === 'Terraria.ModLoader.ModContent') {
        const td = asm.typeByName.get(callee.typeArgs[0]);
        if (td && isConfigType(asm, td)) return { k: 'config', td };
      }
      if (ctx.recv?.k === 'config' && callee.name.startsWith('get_') && args.length === 0) return value(ctx.recv.td, callee.name.slice(4));
      return undefined;
    },
    onLoad(recv, name) {
      if (recv?.k === 'config') return value(recv.td, name);
      return undefined;
    },
  };
}
