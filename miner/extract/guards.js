/**
 * Which parts of a method run only when some condition holds.
 *
 * A weapon's `Shoot` and a projectile's `AI` are both full of "…but only if": only on a stealth
 * strike, only on the right click, only on a one-in-ten roll. Read without the guard, every one of
 * those becomes something the weapon does on every use, which is the most optimistic reading
 * available and the source of a whole family of over-scores.
 *
 * Shared by `shoot.js` and `projectiles.js`, which is why it lives here rather than in either: the
 * projectile side needs the same reading and cannot import from the weapon side without a cycle.
 */
import { decodeIL, ldcValue } from '../clr/il.js';

/**
 * Ranges of a method guarded by a condition the miner can name, as `[{ lo, hi, on }]` — `on` marks
 * the side of the branch the condition holds on. `scan(ins, branchAt)` walks the IL and calls
 * `branchAt(i)` at each branch that consumes the condition, which is what differs between one guard
 * and the next; the region arithmetic below is the same for all of them.
 */
export function guardRanges(asm, m, scan) {
  const body = asm.methodBody(m);
  if (!body) return [];
  let ins;
  try { ins = decodeIL(body.il); } catch { return []; }
  const out = [];
  const byOffset = new Map(ins.map((x, i) => [x.offset, i]));
  /** `extra` rides along on both sides of the branch — a probability, say, for the guard that has one. */
  const branchAt = (i, extra = null) => {
    const x = ins[i];
    if (!x) return;
    const push = (r) => out.push(extra ? { ...r, ...extra } : r);
    // `brfalse` and `bne.un` both jump away when the condition fails, so the fall-through is the
    // side it holds on; `brtrue` and `beq` jump *to* that side.
    const isFalse = /^brfalse/.test(x.op) || /^bne\.un/.test(x.op);
    if (!isFalse && !/^brtrue/.test(x.op) && !/^beq/.test(x.op)) return;
    const target = x.operand;
    const next = ins[i + 1]?.offset ?? x.offset;
    const ti = byOffset.get(target);
    const before = ti !== undefined ? ins[ti - 1] : null;
    const elseEnd = before && /^br(\.s)?$/.test(before.op) && before.operand > target ? before.operand : null;
    if (isFalse) {
      push({ lo: next, hi: target, on: true });
      if (elseEnd) push({ lo: target, hi: elseEnd, on: false });
    } else {
      push({ lo: next, hi: target, on: false });
      if (elseEnd) push({ lo: target, hi: elseEnd, on: true });
      else {
        // `if (cond) { ... return; }` - the block ends at its first terminator
        const end = ins.slice(ti).find((y) => /^(ret|br|br\.s|throw)$/.test(y.op));
        push({ lo: target, hi: end ? end.offset + 1 : Infinity, on: true });
      }
    }
  };
  scan(ins, branchAt);
  return out;
}

/**
 * The odds a `NextBool` guard passes, read off the constants pushed for its arguments.
 *
 *   NextBool()      1 in 2
 *   NextBool(n)     1 in n
 *   NextBool(a, b)  a in b
 *
 * The extension form carries the random itself as the first argument, and that is not a constant,
 * so taking the trailing constants handles both spellings without asking which one this is.
 */
function nextBoolChance(ins, i, callee) {
  const argc = callee?.sig?.params?.length ?? 0;
  const consts = [];
  for (let j = i - 1; j >= 0 && consts.length < argc; j--) {
    const v = ldcValue(ins[j]);
    if (typeof v !== 'number') break;
    consts.unshift(v);
  }
  const p = consts.length === 0 ? 0.5 : consts.length === 1 ? 1 / consts[0] : consts[0] / consts[1];
  return Number.isFinite(p) && p > 0 && p <= 1 ? p : null;
}

/**
 * Ranges of a method guarded by a `NextBool` roll, carrying the odds.
 *
 * Without this a one-in-ten branch is a certainty: the machine cannot say which way the roll went,
 * so a projectile fired only on that roll was counted on every use. It is why Calamity can afford
 * to pay a rare projectile fifteen times the weapon's damage and why the model had to treat a
 * multiplier that large as unreadable — the rarity was the part that went missing, not the damage.
 */
export function chanceRanges(asm, m) {
  return guardRanges(asm, m, (ins, branchAt) => {
    for (let i = 0; i < ins.length; i++) {
      const x = ins[i];
      if (x.op !== 'call' && x.op !== 'callvirt') continue;
      const r = asm.resolve(x.operand);
      if (r?.name !== 'NextBool') continue;
      const p = nextBoolChance(ins, i, r);
      if (p === null) continue;
      branchAt(i + 1, { p });
    }
  });
}

/**
 * How many of a projectile the player may own at once, from the near-universal shape
 * `player.ownedProjectileCounts[type] < N`.
 *
 * It is the fact that decides what a persistent weapon is really worth. A cloud you drop, a tether
 * you maintain, a wall of thorns: what they do per second is the hit rate of *one* of them times how
 * many are alive, and how many are alive is this number — not how many the weapon throws per use,
 * and not a flat share of the fight. Without it the model has to guess an uptime for the whole
 * archetype, which is the same guess for a cloud that lasts one second and one that lasts ten.
 *
 * The same spelling appears in `CanUseItem` (the weapon refusing to fire another) and in the
 * projectile's own `AI` (the projectile killing the oldest of its kind), so one reader serves both.
 * @returns {number|undefined}
 */
export function ownedCapOf(asm, m) {
  const body = m && asm.methodBody(m);
  if (!body) return undefined;
  let ins;
  try { ins = decodeIL(body.il); } catch { return undefined; }
  for (let i = 0; i < ins.length; i++) {
    const f = ins[i].op === 'ldfld' ? asm.resolve(ins[i].operand) : null;
    if (f?.name !== 'ownedProjectileCounts') continue;
    // …[index] then a compare against the cap: `< N` and `<= N-1` are the two spellings
    for (let j = i + 1; j < Math.min(i + 12, ins.length); j++) {
      const n = ldcValue(ins[j]);
      if (typeof n !== 'number') continue;
      const op = ins[j + 1]?.op ?? '';
      if (/^(clt|blt|bge)/.test(op)) return Math.max(1, n);
      if (/^(cgt|ble|bgt)/.test(op)) return Math.max(1, n + 1);
      break;
    }
  }
  return undefined;
}

/** The odds of reaching an offset: every priced guard it sits inside, multiplied. */
export function chanceAt(ranges, o) {
  const rs = ranges.filter((x) => o >= x.lo && o < x.hi);
  if (!rs.length) return undefined;
  const p = rs.reduce((acc, r) => acc * (r.on ? r.p : 1 - r.p), 1);
  return p > 0 && p < 1 ? p : undefined;
}
