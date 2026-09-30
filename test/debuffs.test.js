import { describe, expect, test } from 'bun:test';
import { resolveDebuffs } from '../miner/extract/debuffs.js';

const G = 'Mod.GlobalNPC';
const scan = ({ buffs = [], gates = {}, ties = {}, hitReads = [], named = [] }) => ({
  buffs,
  gates: new Map(Object.entries(gates)),
  ties: new Map(Object.entries(ties).map(([k, v]) => [k, new Set(v)])),
  hitReads: new Set(hitReads),
  named: new Set(named),
});
const buff = (name, extra = {}) => ({ name, flags: [], engine: false, npcUpdate: true, ...extra });

describe('what a mod debuff costs an NPC', () => {
  test('Calamity states it as data: lifeRegen is half-points a second', () => {
    const r = resolveDebuffs([scan({ buffs: [buff('Irradiated', { lostRegen: 20 }), buff('Shred', { lostRegen: null })] })]);
    expect(r.get('Irradiated').dot).toBe(10);
    // a DebuffData whose number is not a constant is a DoT of a size not read: left to the allowance
    expect(r.has('Shred')).toBe(false);
  });
  test('a flag behind a lifeRegen decrease is its DoT; behind nothing it is crowd control', () => {
    const r = resolveDebuffs([scan({
      buffs: [buff('Poison', { flags: [`${G}::poison`] }), buff('Stun', { flags: [`${G}::stun`] })],
      gates: { [`${G}::poison`]: [{ k: 20 }], [`${G}::stun`]: [] },
    })]);
    expect(r.get('Poison').dot).toBe(10);
    expect(r.get('Stun')).toMatchObject({ dot: 0 });
  });
  test('a flag that keeps a damaging stack alive is followed one step', () => {
    const r = resolveDebuffs([scan({
      buffs: [buff('Spearmint', { flags: [`${G}::debuffSpearmint`] })],
      gates: { [`${G}::spearmint`]: [{ k: 50 }] },
      ties: { [`${G}::debuffSpearmint`]: [`${G}::spearmint`] },
    })]);
    expect(r.get('Spearmint').dot).toBe(25);
  });
  test('a mark, an unread size, or a buff the regen code names stays unknown', () => {
    const r = resolveDebuffs([scan({
      buffs: [
        buff('Tuned', { flags: [`${G}::tuned`] }), // read where the NPC takes a hit: it amplifies
        buff('Helper', { flags: [`${G}::helper`] }), // a loss of a size the walk did not follow
        buff('Named', { flags: [`${G}::named`] }),
        buff('OnFire', { flags: ['Terraria.NPC::onFire'], engine: true }), // a vanilla DoT flag
      ],
      gates: { [`${G}::helper`]: [{ k: null }] },
      hitReads: [`${G}::tuned`],
      named: ['Named'],
    })]);
    for (const n of ['Tuned', 'Helper', 'Named', 'OnFire']) expect(r.has(n)).toBe(false);
  });
});
