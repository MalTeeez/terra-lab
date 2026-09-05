import { describe, expect, test } from 'bun:test';
import { CONFIDENCE, PHASE_KINDS, RELATIONS, TRIGGERS, contactPhase, debuffPhases, deliveryPhases, makePhase, spawnPhases, summonPhase, textGates } from '../src/lib/phases.js';

describe('phase records', () => {
  test('every gate has a defined default, and `null` means "not read"', () => {
    const p = makePhase('travel');
    // the gates are what the rest of the rework fills in; none of them may default to "no gate",
    // because "the miner did not read a spawn rate" is exactly why the model needs a blanket cap
    expect(p).toMatchObject({ chance: null, threshold: null, cooldown: null, maxActive: null, requires: null });
    expect(p).toMatchObject({ count: 1, spread: 0, fan: false, velMul: 1, dmgMul: 1, relation: 'concurrent', confidence: 'assumed' });
  });
  test('a kind, relation, trigger or confidence outside the vocabulary is a mistake, not a new feature', () => {
    expect(() => makePhase('deathray')).toThrow(/unknown phase kind/);
    expect(() => makePhase('travel', { relation: 'sometimes' })).toThrow(/unknown relation/);
    expect(() => makePhase('travel', { confidence: 'vibes' })).toThrow(/unknown confidence/);
    expect(() => makePhase('travel', { trigger: 'vibes' })).toThrow(/unknown trigger/);
    for (const k of PHASE_KINDS) expect(makePhase(k).kind).toBe(k);
    for (const r of RELATIONS) expect(makePhase('travel', { relation: r }).relation).toBe(r);
    for (const t of TRIGGERS) expect(makePhase('travel', { trigger: t }).trigger).toBe(t);
    for (const c of CONFIDENCE) expect(makePhase('travel', { confidence: c }).confidence).toBe(c);
  });
  test('an unread damage share survives as null — `?? 1` would make it a full-damage child', () => {
    // this is the whole point of the record: "the miner could not read it" and "it is ×1" are
    // different facts, and folding them together doubles every child whose share went unread
    expect(makePhase('split', { dmgMul: null }).dmgMul).toBe(null);
    expect(makePhase('split').dmgMul).toBe(1);
    expect(makePhase('split', { dmgMul: 0 }).dmgMul).toBe(0);
  });
});

describe('spawnPhases', () => {
  const kids = (children, variant = 'spam') => spawnPhases({ children }, { variant, parentId: 'p' });

  test('the trigger that creates a child is recorded, because it is the gate on how often it runs', () => {
    const out = kids([{ type: 'blast', where: 'hit' }, { type: 'shard', where: 'kill' }, { type: 'bolt', where: 'ai' }, { type: 'mystery' }]);
    expect(out.map((p) => [p.kind, p.trigger])).toEqual([
      ['impact', 'hit'], ['split', 'death'], ['split', 'timer'],
      ['split', 'timer'], // a `where` the miner never named runs on a clock nobody read
    ]);
  });
  test('a share read, a flat number read, and nothing read are three different facts', () => {
    const [share, flat, unread] = kids([{ type: 'a', dmgMul: 0.5 }, { type: 'b', dmgAbs: 40 }, { type: 'c' }]);
    expect(share).toMatchObject({ dmgMul: 0.5, dmgAbs: null, confidence: 'exact' });
    expect(flat).toMatchObject({ dmgMul: null, dmgAbs: 40, confidence: 'exact' });
    expect(unread).toMatchObject({ dmgMul: null, dmgAbs: null, confidence: 'assumed' });
  });
  test('a child gated on the stealth strike does not spawn on an ordinary throw', () => {
    const children = [{ type: 'always' }, { type: 'onStrike', stealth: true }, { type: 'onThrow', stealth: false }];
    expect(kids(children, 'spam').map((p) => p.projId)).toEqual(['always', 'onThrow']);
    expect(kids(children, 'stealth').map((p) => p.projId)).toEqual(['always', 'onStrike']);
  });
  test('a projectile with no children has no spawn phases', () => {
    expect(spawnPhases(null, { variant: 'spam' })).toEqual([]);
    expect(spawnPhases({}, { variant: 'spam' })).toEqual([]);
  });
});

describe('deliveryPhases', () => {
  test('a weapon that only fires its own projectile is one default phase', () => {
    const { phases, hasDefault } = deliveryPhases(null, { variant: 'spam', primaryId: 'v:1' });
    expect(hasDefault).toBe(true);
    expect(phases).toHaveLength(1);
    expect(phases[0]).toMatchObject({ id: 'default', kind: 'travel', region: 'default', projId: 'v:1', count: 1, confidence: 'exact' });
  });
  test('a weapon with no projectile at all still gets a phase, marked as the assumption it is', () => {
    expect(deliveryPhases(null, { variant: 'spam', primaryId: null }).phases[0].confidence).toBe('assumed');
  });
  test('`shoot` resolves to the primary, and the mined multiplier is kept raw', () => {
    const fire = { calls: [{ type: 'shoot', count: 3, spread: 0.2, fan: true, dmgMul: 15 }] };
    const [p] = deliveryPhases(fire, { variant: 'spam', primaryId: 'v:9' }).phases;
    expect(p).toMatchObject({ projId: 'v:9', count: 3, spread: 0.2, fan: true, region: 'top', relation: 'concurrent' });
    // the record keeps what the miner read; deciding an unreadable ×15 is a branch is the model's job
    expect(p.dmgMul).toBe(15);
    expect(p.evidence).toMatchObject({ from: 'Shoot', call: 0 });
  });
  test('branches of one if/else are alternatives of each other, `top` is not', () => {
    const fire = { calls: [{ type: 'a' }, { type: 'b', region: 'if:1' }, { type: 'c', region: 'if:1' }] };
    const { phases } = deliveryPhases(fire, { variant: 'spam' });
    expect(phases.map((p) => [p.region, p.relation])).toEqual([['top', 'concurrent'], ['if:1', 'alternative'], ['if:1', 'alternative']]);
  });
  test('only this variant and this click, and an unguarded call belongs to both', () => {
    const fire = { calls: [{ type: 'always' }, { type: 'onlyStealth', variant: 'stealth' }, { type: 'right', alt: true }, { type: 'left', alt: false }] };
    const ids = (o) => deliveryPhases(fire, o).phases.map((p) => p.projId);
    expect(ids({ variant: 'spam', alt: false })).toEqual(['always', 'left']);
    expect(ids({ variant: 'stealth', alt: false })).toEqual(['always', 'onlyStealth', 'left']);
    expect(ids({ variant: 'spam', alt: true })).toEqual(['always', 'right']);
  });
  test('what the other click throws is stocked, not damage this attack deals', () => {
    const fire = { calls: [{ type: 'dagger', alt: false }, { type: 'bolt', alt: true }] };
    expect([...deliveryPhases(fire, { variant: 'spam', alt: false }).stocked]).toEqual(['bolt']);
    expect([...deliveryPhases(fire, { variant: 'spam', alt: true }).stocked]).toEqual(['dagger']);
  });
  test('the default shot is added only when Shoot did not replace it', () => {
    const has = (fire) => deliveryPhases(fire, { variant: 'spam', primaryId: 'v:1' }).phases.some((p) => p.id === 'default');
    expect(has({ calls: [{ type: 'a' }] })).toBe(false);              // Shoot replaced it
    expect(has({ calls: [{ type: 'a' }], returnsTrue: true })).toBe(true); // …and also fired its own
    expect(has({ calls: [{ type: 'a' }], defaultShot: { spam: true } })).toBe(true);
    expect(has({ calls: [{ type: 'a' }], defaultShot: { spam: false } })).toBe(false);
  });
  test('the default shot comes last, because that is the order it is paid for in', () => {
    const fire = { calls: [{ type: 'a' }, { type: 'b', region: 'if:1' }], returnsTrue: true };
    expect(deliveryPhases(fire, { variant: 'spam', primaryId: 'v:1' }).phases.at(-1).id).toBe('default');
  });
});

describe('debuffPhases', () => {
  test('one record per distinct debuff, in the order found across everything the weapon fires', () => {
    const out = debuffPhases([{ debuffs: ['Poisoned', 'OnFire'] }, null, { debuffs: ['OnFire', 'Frostburn'] }]);
    expect(out.map((p) => p.buffId)).toEqual(['Poisoned', 'OnFire', 'Frostburn']);
    expect(out[0]).toMatchObject({ kind: 'debuff', trigger: 'hit', id: 'debuff:Poisoned' });
  });
  test('a weapon that applies nothing has no debuff phases', () => {
    expect(debuffPhases([null, {}, { debuffs: [] }])).toEqual([]);
  });
});

describe('summonPhase', () => {
  test('slots are a resource cost, named the same way mana and Void will be', () => {
    const p = summonPhase({ local: 20, slots: 2 }, 'minion', { projId: 'v:1' });
    expect(p).toMatchObject({ kind: 'minion', projId: 'v:1', cooldown: 20, confidence: 'exact' });
    expect(p.resource).toEqual({ kind: 'minionSlots', cost: 2 });
  });
  test('a summon with no slot cost read still costs one', () => {
    expect(summonPhase({}, 'sentry').resource).toEqual({ kind: 'minionSlots', cost: 1 });
    expect(summonPhase({}, 'sentry').confidence).toBe('assumed');
  });
  test('a negative hit cooldown is kept raw: it is "once, ever", not a rate', () => {
    // the model reads it as a rate and gets a negative one; the record states the fact so the bug
    // is visible rather than hidden behind a helper that maps it to null
    expect(summonPhase({ local: -1 }, 'minion').cooldown).toBe(-1);
    expect(summonPhase({ local: -1 }, 'minion').confidence).toBe('assumed');
  });
});

describe('textGates', () => {
  test('a tick the tooltip states is an interval; a DoT rate is not', () => {
    expect(textGates('The chains deal damage once every second').interval).toBe(60);
    expect(textGates('Deals damage to foes every 4 seconds').interval).toBe(240);
    expect(textGates('Once every two seconds').interval).toBe(120);
    expect(textGates('Hits may infect enemies for 12 damage per second').interval).toBe(null);
    expect(textGates('Every second hit deals double damage').interval).toBe(null); // a counter, not a clock
  });
  test('"up to N enemies" is a cap; "up to N times" is how often, not how many', () => {
    expect(textGates('Up to 3 enemies can be chained to you').maxActive).toBe(3);
    expect(textGates('Bounces up to 5 times').maxActive).toBe(null);
  });
  test('a hit counter is a threshold; a use counter or a return counter is not', () => {
    expect(textGates('Fire a series of bullets after hit enemy 8 times in a row').threshold).toBe(8);
    expect(textGates('After hitting four times, releases a burst').threshold).toBe(4);
    expect(textGates('Every five hits spawn a spore').threshold).toBe(5);
    expect(textGates('After returning three times it explodes').threshold).toBe(null);
    expect(textGates('Fires every half second up to 10 times').threshold).toBe(null);
    expect(textGates('Every fourth shot is a rocket').threshold).toBe(null);
  });
  test('a stated cooldown is what a proc can fire at most', () => {
    expect(textGates('Creates a shockwave on hit, 30 second cooldown').cooldown).toBe(1800);
    expect(textGates('Has a cooldown of 5 seconds').cooldown).toBe(300);
    expect(textGates('Cools down quickly').cooldown).toBe(null);
  });
  test('nothing read is null, and the evidence quotes the clause', () => {
    expect(textGates(undefined)).toMatchObject({ interval: null, maxActive: null, threshold: null });
    expect(textGates('Up to 3 enemies can be chained').evidence).toEqual({ maxActive: 'Up to 3 enemies' });
    expect(makePhase('travel')).toMatchObject({ interval: null, duration: null });
  });
});

describe('contactPhase', () => {
  test('a projectile that owns a hit cooldown hits on it', () => {
    expect(contactPhase({ local: 12 }, 'yoyo')).toMatchObject({ kind: 'contact', cooldown: 12, confidence: 'exact' });
  });
  test('no cooldown means the player\'s own immunity window governs — not "never hits"', () => {
    expect(contactPhase({}, 'held').cooldown).toBe(null);
    expect(contactPhase(null, 'held').cooldown).toBe(null);
  });
});
