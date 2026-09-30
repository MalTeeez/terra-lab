/**
 * What a mod's debuff does to an NPC's health, read from the mod's own code — the half of
 * `miner/stage/debuffs.json` the code can answer for itself.
 *
 * Health loss on an NPC is `NPC.lifeRegen`, in half-points a second (`lifeRegen -= 20` is 10 HP/s),
 * and a mod writes it in three shapes:
 *
 *   - **as data** — Calamity gives every damaging debuff a static `DebuffData` whose
 *     `EnemyLostRegen` one loop in `CalamityGlobalNPC.UpdateLifeRegen` subtracts for all of them;
 *   - **behind a flag** — the buff's `Update(NPC, ref int)` sets a field on the mod's GlobalNPC and
 *     that GlobalNPC's `UpdateLifeRegen` subtracts a constant inside `if (flag)` (Thorium, most others);
 *   - **directly** — the buff's `Update` writes `npc.lifeRegen` itself.
 *
 * …and a fourth answer, the one the model needs most: a debuff whose flags gate no health loss
 * anywhere is crowd control — Thorium's Paralyzed only pins the NPC's position inside `if
 * (debuffParalyzed || debuffPetrify || debuffStunned)` — and costs a boss nothing. Until this was
 * read, every such debuff was priced at the flat allowance for an unread one, which is what made a
 * stun look like 12 DPS of poison.
 *
 * Two things stop a reading at "unknown" rather than zero: a flag also read where the NPC *takes a
 * hit* (`ModifyHitBy*`, Thorium's `ModifyHit` — a mark that amplifies damage, which the allowance
 * stands in for), and a buff the regen code names directly (`HasBuff<T>()`), whose effect the flag
 * walk does not see.
 */
import { BRANCH_OPS, decodeIL, ldcValue } from '../clr/il.js';
import { TYPE_ABSTRACT, derivesFromTml } from './util.js';

const REGEN = 'Terraria.NPC::lifeRegen';
// where the NPC takes a hit — `ModifyHitBy*`, Thorium's own `ModifyHit` and its helpers — and not
// `ModifyHitPlayer`, which is the NPC hitting you
const HIT_HOOK = /^Modify(?!HitPlayer$)\w*Hit\w*$|^ModifyIncomingHit$/;
const keyOf = (f) => `${f?.declaringType?.fullName ?? '?'}::${f?.name}`;
const constAt = (x) => (x && (x.op === 'ldc.r4' || x.op === 'ldc.r8') ? x.operand : x ? ldcValue(x) : undefined);

function decode(asm, m) {
  const body = m && asm.methodBody(m);
  if (!body) return null;
  try { return decodeIL(body.il); } catch { return null; }
}

function field(asm, x) {
  if (x?.op !== 'ldfld' && x?.op !== 'stfld' && x?.op !== 'ldflda' && x?.op !== 'ldsfld') return null;
  try { return asm.resolve(x.operand); } catch { return null; }
}

const localOf = (x) => (x.operand !== undefined ? x.operand : Number(x.op.split('.').pop()));
/** Where a loaded value is used: past the `nop`s and the `stloc N; ldloc N` a debug build (Stars Above) parks it in. */
function nextUse(ins, j) {
  while (ins[j]) {
    if (ins[j].op === 'nop') { j++; continue; }
    if (/^stloc/.test(ins[j].op) && /^ldloc/.test(ins[j + 1]?.op ?? '') && localOf(ins[j]) === localOf(ins[j + 1])) { j += 2; continue; }
    break;
  }
  return j;
}

/**
 * The branch a field loaded at `i` feeds, past a compare against zero: `if (flag)`, `if (stacks > 0)`
 * (`ldc 0; ble`), or the same built as a bool first (`ldc 0; cgt; brfalse`).
 * @returns {{ j: number, zero: boolean }|null}
 */
function testOf(ins, i) {
  let j = nextUse(ins, i + 1);
  let zero = false;
  if (constAt(ins[j]) === 0) {
    zero = true;
    j++;
    if (/^cgt/.test(ins[j]?.op ?? '')) { zero = false; j = nextUse(ins, j + 1); }
  }
  const br = ins[j];
  return br && BRANCH_OPS.has(br.op) && br.operand > br.offset && ins[j + 1] ? { j, zero } : null;
}

/**
 * The instructions that run when the field loaded at `i` is set: `if (flag)` / `if (stacks > 0)`
 * falls through into its body, and an `a || b || c` chain jumps into a body that ends where the
 * chain's last test skips to. Anything else (the field used as a value, a loop) is not a gate.
 * @returns {[number, number]|null} offsets [lo, hi)
 */
function setRegion(ins, i) {
  const t = testOf(ins, i);
  if (!t) return null;
  const { j, zero } = t;
  const br = ins[j];
  const op = br.op.replace(/\.s$/, '');
  if (op === 'brfalse' || (zero && /^(ble|beq)/.test(op))) return [ins[j + 1].offset, br.operand];
  if (op === 'brtrue' || (zero && /^(bgt|bne)/.test(op))) {
    for (let q = j + 1; q < ins.length && ins[q].offset < br.operand; q++) {
      if (BRANCH_OPS.has(ins[q].op) && ins[q].operand > br.operand) return [br.operand, ins[q].operand];
    }
  }
  return null;
}

/**
 * The instructions either arm of a test on the field loaded at `i` skips over — what the field
 * decides, whichever way round. Thorium's Spearmint sets `debuffSpearmint` and `PostAI` clears the
 * stack that does the damage behind `if (!debuffSpearmint) spearmint = 0`: the flag keeps the
 * stack alive, and the stack is what `UpdateLifeRegen` reads.
 * @returns {[number, number]|null}
 */
function branchSpan(ins, i) {
  const t = testOf(ins, i);
  return t ? [ins[t.j + 1].offset, ins[t.j].operand] : null;
}

/**
 * Every health loss written between two offsets: `lifeRegen -= K` (stored after a `sub`), or the
 * field's address handed to a helper that subtracts for it (Calamity's `ApplyDPSDebuff(K, …, ref
 * lifeRegen, …)`). `k` is the constant where one is written, `null` where it is not.
 */
function lossesIn(asm, ins, lo, hi) {
  const out = [];
  for (let q = 0; q < ins.length; q++) {
    const x = ins[q];
    if (x.offset < lo || x.offset >= hi) continue;
    const f = field(asm, x);
    if (!f || keyOf(f) !== REGEN) continue;
    if (x.op === 'stfld' && ins[q - 1]?.op === 'sub') {
      let from = q - 2;
      while (from > 0 && !(ins[from].op === 'ldfld' && keyOf(field(asm, ins[from])) === REGEN)) from--;
      let k = null;
      for (let r = from + 1; r < q - 1 && k === null; r++) { const c = constAt(ins[r]); if (c > 0) k = c; }
      out.push({ k });
    } else if (x.op === 'ldflda' && ins.slice(q + 1, q + 4).some((y) => /^call/.test(y.op))) {
      let k = null;
      for (let r = q - 1; r >= Math.max(0, q - 5) && k === null; r--) { const c = constAt(ins[r]); if (c > 0) k = c; }
      out.push({ k });
    }
  }
  // …and a helper the region calls that writes the field itself (Calamity's `Shred.TickDebuff`,
  // behind `somaShredStacks > 0`): a loss, of a size this does not follow
  for (const x of ins) {
    if (x.offset < lo || x.offset >= hi || !/^call/.test(x.op)) continue;
    let m;
    try { m = asm.resolve(x.operand); } catch { continue; }
    const body = m?.kind === 'method' && m.def ? decode(asm, m.def) : null;
    if (body?.some((y) => (y.op === 'stfld' || y.op === 'ldflda') && keyOf(field(asm, y)) === REGEN)) out.push({ k: null });
  }
  return out;
}

/**
 * One assembly's share of the evidence: its buffs, and what its GlobalNPCs do with the flags any
 * buff may set (a Thorium addon's buff can set a field on Thorium's GlobalNPC, so the two halves are
 * joined only once every mod has been read — see `resolveDebuffs`).
 */
export function scanDebuffs(asm) {
  const buffs = [];
  const gates = new Map(); // flag key → [{ k }]
  const ties = new Map(); // flag key → other fields it decides (see `branchSpan`)
  const hitReads = new Set(); // flag keys read where the NPC takes a hit
  const named = new Set(); // buff types the regen code names outright
  for (const td of asm.types) {
    if (td.flags & TYPE_ABSTRACT) continue;
    if (td.name.includes('`') || td.name.startsWith('<')) continue;
    if (derivesFromTml(asm, td, 'ModBuff')) {
      const b = { name: td.name, flags: [], engine: false };
      const cctor = decode(asm, td.methods.find((m) => m.name === '.cctor'));
      for (let i = 1; cctor && i < cctor.length; i++) {
        // a constant is the reading; anything else (Shred's `BaseDamage` static) is a DoT of a size not followed
        if (cctor[i].op === 'stfld' && field(asm, cctor[i])?.name === 'EnemyLostRegen') b.lostRegen = constAt(cctor[i - 1]) >= 0 ? constAt(cctor[i - 1]) : null;
      }
      const upd = td.methods.find((m) => m.name === 'Update' && asm.methodSig(m).params.length === 2 && asm.typeName(asm.methodSig(m).params[0]) === 'Terraria.NPC');
      const ins = decode(asm, upd);
      if (ins) {
        b.npcUpdate = true;
        for (let i = 0; i < ins.length; i++) {
          if (ins[i].op !== 'stfld') continue;
          const f = field(asm, ins[i]);
          const key = keyOf(f);
          if (key === REGEN) { const [l] = lossesIn(asm, ins, ins[i].offset, ins[i].offset + 1); if (l) b.selfLoss = l; continue; }
          // a flag on the game's own NPC (`npc.onFire = true`) is a vanilla DoT this walk does not price
          if (/^(Terraria|Microsoft|System)\./.test(f?.declaringType?.fullName ?? '')) { b.engine = true; continue; }
          if (f && f.declaringType?.fullName !== td.fullName) b.flags.push(key);
        }
      }
      buffs.push(b);
      continue;
    }
    // …a mark read where the *player* lands a hit amplifies it just the same (Stars Above's
    // `WeaponPlayer.ModifyHitNPCWithProj` reads Nanite Plague)
    if (['ModPlayer', 'GlobalProjectile', 'GlobalItem'].some((b) => derivesFromTml(asm, td, b))) {
      for (const m of td.methods) {
        const ins = /^ModifyHitNPC\w*$/.test(m.name) ? decode(asm, m) : null;
        for (const x of ins ?? []) if (x.op === 'ldfld') hitReads.add(keyOf(field(asm, x)));
      }
      continue;
    }
    if (!derivesFromTml(asm, td, 'GlobalNPC')) continue;
    for (const m of td.methods) {
      const ins = decode(asm, m);
      if (!ins) continue;
      for (let i = 0; i < ins.length; i++) {
        const span = ins[i].op === 'ldfld' ? branchSpan(ins, i) : null;
        if (span) {
          const key = keyOf(field(asm, ins[i]));
          for (const x of ins) {
            if (x.op !== 'stfld' || x.offset < span[0] || x.offset >= span[1]) continue;
            const g = field(asm, x);
            if (!g || keyOf(g) === key || /^(Terraria|Microsoft|System)\./.test(g.declaringType?.fullName ?? '')) continue;
            if (!ties.has(key)) ties.set(key, new Set());
            ties.get(key).add(keyOf(g));
          }
        }
        if (m.name !== 'UpdateLifeRegen' && !HIT_HOOK.test(m.name)) continue;
        if (m.name !== 'UpdateLifeRegen') { if (ins[i].op === 'ldfld') hitReads.add(keyOf(field(asm, ins[i]))); continue; }
        if (/^call/.test(ins[i].op)) { try { for (const t of asm.resolve(ins[i].operand)?.typeArgs ?? []) named.add(String(t).split('.').pop()); } catch { /* unresolvable */ } }
        if (ins[i].op !== 'ldfld') continue;
        const region = setRegion(ins, i);
        if (!region) continue;
        const key = keyOf(field(asm, ins[i]));
        const l = gates.get(key) ?? [];
        l.push(...lossesIn(asm, ins, region[0], region[1]));
        gates.set(key, l);
      }
    }
  }
  return { buffs, gates, ties, hitReads, named };
}

/**
 * Join every assembly's scan into what each debuff costs an NPC, keyed by buff class name the way
 * `debuffs.json` and the projectile records are. A buff the code gives no answer for is left out —
 * the model's allowance for an unread debuff still stands for it.
 * @returns {Map<string, { dot: number, via: string }>}
 */
export function resolveDebuffs(scans) {
  const gates = new Map();
  const ties = new Map();
  const hitReads = new Set();
  const named = new Set();
  for (const s of scans) {
    for (const [k, l] of s.gates) gates.set(k, [...(gates.get(k) ?? []), ...l]);
    for (const [k, t] of s.ties) ties.set(k, new Set([...(ties.get(k) ?? []), ...t]));
    for (const k of s.hitReads) hitReads.add(k);
    for (const n of s.named) named.add(n);
  }
  const out = new Map();
  for (const s of scans) {
    for (const b of s.buffs) {
      if (out.has(b.name)) continue;
      if (b.lostRegen !== undefined) { if (b.lostRegen !== null) out.set(b.name, { dot: b.lostRegen / 2, via: 'DebuffData.EnemyLostRegen' }); continue; }
      if (b.selfLoss?.k > 0) { out.set(b.name, { dot: b.selfLoss.k / 2, via: 'Update writes npc.lifeRegen' }); continue; }
      if (!b.npcUpdate || !b.flags.length || b.engine || b.selfLoss) continue;
      // what the flag gates, and what the fields it decides gate in turn — one step, no further
      const reach = [...new Set(b.flags.flatMap((f) => [f, ...(ties.get(f) ?? [])]))];
      const losses = reach.flatMap((f) => gates.get(f) ?? []);
      if (losses.some((l) => !(l.k > 0))) continue;
      if (losses.length) { out.set(b.name, { dot: Math.max(...losses.map((l) => l.k)) / 2, via: 'UpdateLifeRegen behind the flag it sets' }); continue; }
      if (named.has(b.name) || reach.some((f) => hitReads.has(f))) continue;
      out.set(b.name, { dot: 0, via: 'no health loss behind any flag it sets' });
    }
  }
  return out;
}
