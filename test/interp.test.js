import { describe, expect, test } from 'bun:test';
import { ITEM, Machine, THIS, tmlStaticHook } from '../miner/extract/interp.js';
import { ET } from '../miner/clr/sig.js';

/**
 * A stub assembly: hand-assembled IL plus a token table. Enough for the Machine to
 * resolve calls/fields without a real PE image.
 */
const VOID = { et: ET.VOID };
const I4 = { et: ET.I4 };
const OBJ = { et: ET.OBJECT };
const T = {
  GET_ITEM: 0x0a000001,
  FLD_DAMAGE: 0x0a000002,
  GET_MELEE: 0x0a000003,
  SET_DAMAGETYPE: 0x0a000004,
  FLD_USETIME: 0x0a000005,
  SFLD_FLAG: 0x0a000006,
};
const descriptors = {
  [T.GET_ITEM]: { kind: 'method', name: 'get_Item', declaringType: { fullName: 'Terraria.ModLoader.ModItem' }, sig: { hasThis: true, params: [], ret: OBJ } },
  [T.FLD_DAMAGE]: { kind: 'field', name: 'damage', declaringType: { fullName: 'Terraria.Item' }, type: I4 },
  [T.FLD_USETIME]: { kind: 'field', name: 'useTime', declaringType: { fullName: 'Terraria.Item' }, type: I4 },
  [T.GET_MELEE]: { kind: 'method', name: 'get_Melee', declaringType: { fullName: 'Terraria.ModLoader.DamageClass' }, sig: { hasThis: false, params: [], ret: OBJ } },
  [T.SET_DAMAGETYPE]: { kind: 'method', name: 'set_DamageType', declaringType: { fullName: 'Terraria.Item' }, sig: { hasThis: true, params: [OBJ], ret: VOID } },
  [T.SFLD_FLAG]: { kind: 'field', name: 'someFlag', declaringType: { fullName: 'Terraria.Main' }, type: I4 },
};

function tok(t) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(t);
  return [...b];
}

function stubAssembly(il, sig) {
  const method = { name: 'M', rva: 1, flags: 0, declaringType: { name: 'X', methods: [] } };
  return {
    asm: {
      name: 'Stub',
      typeByName: new Map(),
      methodBody: (m) => (m === method ? { il: Buffer.from(il), maxStack: 8 } : null),
      methodSig: () => sig,
      resolve: (t) => descriptors[t] ?? null,
      userString: () => '',
      baseOf: () => null,
      fieldType: () => I4,
      fieldData: () => null,
    },
    method,
  };
}

describe('Machine (straight-line)', () => {
  test('records Item field stores and DamageType through the ModItem.Item getter', () => {
    const il = [
      0x02, 0x28, ...tok(T.GET_ITEM), 0x1f, 50, 0x7d, ...tok(T.FLD_DAMAGE), // Item.damage = 50
      0x02, 0x28, ...tok(T.GET_ITEM), 0x28, ...tok(T.GET_MELEE), 0x6f, ...tok(T.SET_DAMAGETYPE), // Item.DamageType = DamageClass.Melee
      0x02, 0x28, ...tok(T.GET_ITEM), 0x1f, 20, 0x7d, ...tok(T.FLD_USETIME), // Item.useTime = 20
      0x2a,
    ];
    const { asm, method } = stubAssembly(il, { hasThis: true, params: [], ret: VOID });
    const stores = {};
    const m = new Machine(asm, {
      onStore: (recv, name, value) => { if (recv === ITEM) stores[name] = value; },
      onCall: (callee, args, ctx) => tmlStaticHook(callee, args, ctx),
    });
    m.run(method, THIS, []);
    expect(stores.damage).toBe(50);
    expect(stores.useTime).toBe(20);
    expect(stores.DamageType).toEqual({ k: 'dc', name: 'Melee', full: 'Terraria.ModLoader.DamageClass.Melee' });
  });

  test('evaluates arithmetic on constants and follows forward br', () => {
    // Item.damage = (30 * 2) + 5, skipping over a dead block via br
    const il = [
      0x02, 0x28, ...tok(T.GET_ITEM), 0x1f, 30, 0x18, 0x5a, 0x1b, 0x58, 0x7d, ...tok(T.FLD_DAMAGE),
      0x2b, 0x0d, // br.s +13 → over the next store, onto ret
      0x02, 0x28, ...tok(T.GET_ITEM), 0x1f, 99, 0x7d, ...tok(T.FLD_DAMAGE),
      0x2a,
    ];
    const { asm, method } = stubAssembly(il, { hasThis: true, params: [], ret: VOID });
    const stores = {};
    const m = new Machine(asm, { onStore: (recv, name, value) => { if (recv === ITEM) stores[name] = value; } });
    m.run(method, THIS, []);
    expect(stores.damage).toBe(65);
  });
});

describe('Machine (linear, case tracking)', () => {
  test('attributes stores to the item ids of a switch (type - base) table', () => {
    // 0: ldarg.1 ; 1: ldc.i4.1 ; 2: sub ; 3: switch [A, B] ; 16: br END
    // A: ldarg.0 ; ldc.i4.s 10 ; stfld damage ; ret        (offset 21)
    // B: ldarg.0 ; ldc.i4.s 20 ; stfld damage ; ret        (offset 30)
    // END: ret                                            (offset 39)
    const il = [
      0x03, 0x17, 0x59, 0x45, 2, 0, 0, 0, 5, 0, 0, 0, 14, 0, 0, 0, // switch targets relative to offset 16
      0x38, 18, 0, 0, 0, // br +18 → 39
      0x02, 0x1f, 10, 0x7d, ...tok(T.FLD_DAMAGE), 0x2a,
      0x02, 0x1f, 20, 0x7d, ...tok(T.FLD_DAMAGE), 0x2a,
      0x2a,
    ];
    const { asm, method } = stubAssembly(il, { hasThis: true, params: [I4], ret: VOID });
    const byType = {};
    const m = new Machine(asm, {
      linear: true,
      onStore: (recv, name, value, ctx) => { for (const c of ctx.cases) byType[c.value] = { ...(byType[c.value] ?? {}), [name]: value }; },
    });
    m.run(method, ITEM, [{ k: 'key', slot: 0 }]);
    expect(byType[1]).toEqual({ damage: 10 });
    expect(byType[2]).toEqual({ damage: 20 });
  });

  test('attributes stores under `type == N` comparisons and releases the key at the branch target', () => {
    // ldarg.1 ; ldc.i4.s 7 ; bne.un.s SKIP ; ldarg.0 ; ldc.i4.s 33 ; stfld damage ; SKIP: ldarg.0 ; ldc.i4.s 1 ; stfld useTime ; ret
    const il = [
      0x03, 0x1f, 7, 0x33, 8,
      0x02, 0x1f, 33, 0x7d, ...tok(T.FLD_DAMAGE),
      0x02, 0x1f, 1, 0x7d, ...tok(T.FLD_USETIME),
      0x2a,
    ];
    const { asm, method } = stubAssembly(il, { hasThis: true, params: [I4], ret: VOID });
    const seen = [];
    const m = new Machine(asm, {
      linear: true,
      onStore: (recv, name, value, ctx) => seen.push({ name, cases: ctx.cases.map((c) => c.value) }),
    });
    m.run(method, ITEM, [{ k: 'key', slot: 0 }]);
    expect(seen).toEqual([
      { name: 'damage', cases: [7] },
      { name: 'useTime', cases: [] },
    ]);
  });

  test('marks stores inside a nested conditional as conditional', () => {
    // ldarg.0 ; ldc.i4.5 ; stfld damage ; ldsfld flag ; brfalse.s SKIP ; ldarg.0 ; ldc.i4.s 9 ; stfld damage ; SKIP: ret
    const il = [
      0x02, 0x1b, 0x7d, ...tok(T.FLD_DAMAGE),
      0x7e, ...tok(T.SFLD_FLAG), 0x2c, 8,
      0x02, 0x1f, 9, 0x7d, ...tok(T.FLD_DAMAGE),
      0x2a,
    ];
    const { asm, method } = stubAssembly(il, { hasThis: true, params: [], ret: VOID });
    const seen = [];
    const m = new Machine(asm, { linear: true, onStore: (recv, name, value, ctx) => seen.push([value, ctx.conditional]) });
    m.run(method, ITEM, []);
    expect(seen).toEqual([[5, false], [9, true]]);
  });

  test('tags the else-branch when the if-block ends in a return rather than a br', () => {
    // if (!flag) { damage = 1; return; } useTime = 3;   — Thorium's spawn pool is shaped like this
    const il = [
      0x7e, ...tok(T.SFLD_FLAG), 0x2d, 9,          // 0: ldsfld flag ; 5: brtrue.s → 16
      0x02, 0x1f, 1, 0x7d, ...tok(T.FLD_DAMAGE),   // 7: damage = 1
      0x2a,                                        // 15: ret
      0x02, 0x1f, 3, 0x7d, ...tok(T.FLD_USETIME),  // 16: useTime = 3
      0x2a,                                        // 24: ret
    ];
    const { asm, method } = stubAssembly(il, { hasThis: true, params: [], ret: VOID });
    const seen = [];
    const m = new Machine(asm, {
      linear: true,
      onStaticLoad: (f) => (f.name === 'someFlag' ? { k: 'flag', name: 'hardMode' } : undefined),
      onStore: (recv, name, value, ctx) => seen.push([name, [...ctx.condTags]]),
    });
    m.run(method, ITEM, []);
    expect(seen).toEqual([
      ['damage', ['!hardMode']],
      ['useTime', ['hardMode']],
    ]);
  });

  test('tags the else-branch of a flag with the flag, past a nested if/else that ends there', () => {
    // if (!flag) { if (arg) { damage = 1 } else { damage = 2 } } else { useTime = 3 }
    // — the inner else region is clamped to the outer one's end and must not erase the `flag` tag
    const il = [
      0x7e, ...tok(T.SFLD_FLAG), 0x2d, 23,      // 0: ldsfld flag ; 5: brtrue.s → 30
      0x03, 0x2c, 10,                            // 7: ldarg.1 ; 8: brfalse.s → 20
      0x02, 0x1f, 1, 0x7d, ...tok(T.FLD_DAMAGE), // 10: damage = 1
      0x2b, 18,                                  // 18: br.s → 38
      0x02, 0x1f, 2, 0x7d, ...tok(T.FLD_DAMAGE), // 20: damage = 2
      0x2b, 8,                                   // 28: br.s → 38
      0x02, 0x1f, 3, 0x7d, ...tok(T.FLD_USETIME),// 30: useTime = 3
      0x2a,                                      // 38: ret
    ];
    const { asm, method } = stubAssembly(il, { hasThis: true, params: [I4], ret: VOID });
    const seen = [];
    const m = new Machine(asm, {
      linear: true,
      onStaticLoad: (f) => (f.name === 'someFlag' ? { k: 'flag', name: 'hardMode' } : undefined),
      onStore: (recv, name, value, ctx) => seen.push([name, [...ctx.condTags]]),
    });
    m.run(method, ITEM, [{ k: 'key', slot: 0 }]);
    expect(seen).toEqual([
      ['damage', ['!hardMode']],
      ['damage', ['!hardMode']],
      ['useTime', ['hardMode']],
    ]);
  });
});
