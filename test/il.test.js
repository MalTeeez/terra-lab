import { describe, expect, test } from 'bun:test';
import { decodeIL, ldcValue } from '../miner/clr/il.js';

describe('decodeIL', () => {
  test('decodes one-byte opcodes with inline operands', () => {
    // ldarg.0; ldc.i4.s 42; stfld 0x04000010; ret
    const il = Buffer.from([0x02, 0x1f, 0x2a, 0x7d, 0x10, 0x00, 0x00, 0x04, 0x2a]);
    const ins = decodeIL(il);
    expect(ins.map((i) => i.op)).toEqual(['ldarg.0', 'ldc.i4.s', 'stfld', 'ret']);
    expect(ins[1].operand).toBe(42);
    expect(ins[2].operand).toBe(0x04000010);
    expect(ins.map((i) => i.offset)).toEqual([0, 1, 3, 8]);
  });

  test('resolves branch targets to absolute offsets', () => {
    // 0: ldc.i4.0 ; 1: brtrue.s +2 → 5 ; 3: ldc.i4.1 ; 4: ret ; 5: ret
    const il = Buffer.from([0x16, 0x2d, 0x02, 0x17, 0x2a, 0x2a]);
    const ins = decodeIL(il);
    expect(ins[1].op).toBe('brtrue.s');
    expect(ins[1].operand).toBe(5);
  });

  test('decodes switch jump tables relative to the end of the instruction', () => {
    // 0: ldc.i4.1 ; 1: switch [2 targets] ; 14: ret ; 15: ret
    const il = Buffer.alloc(16);
    il[0] = 0x17;
    il[1] = 0x45;
    il.writeUInt32LE(2, 2);
    il.writeInt32LE(0, 6); // → 14
    il.writeInt32LE(1, 10); // → 15
    il[14] = 0x2a;
    il[15] = 0x2a;
    const ins = decodeIL(il);
    expect(ins[1].op).toBe('switch');
    expect(ins[1].operand).toEqual([14, 15]);
    expect(ins[2].offset).toBe(14);
  });

  test('decodes two-byte opcodes and float constants', () => {
    // ldc.r4 0.5 ; ceq (fe 01) ; ret
    const il = Buffer.alloc(8);
    il[0] = 0x22;
    il.writeFloatLE(0.5, 1);
    il[5] = 0xfe;
    il[6] = 0x01;
    il[7] = 0x2a;
    const ins = decodeIL(il);
    expect(ins.map((i) => i.op)).toEqual(['ldc.r4', 'ceq', 'ret']);
    expect(ins[0].operand).toBeCloseTo(0.5);
  });

  test('ldcValue reads the short forms', () => {
    expect(ldcValue({ op: 'ldc.i4.m1' })).toBe(-1);
    expect(ldcValue({ op: 'ldc.i4.7' })).toBe(7);
    expect(ldcValue({ op: 'ldc.i4', operand: 2200 })).toBe(2200);
    expect(ldcValue({ op: 'ldarg.0' })).toBeUndefined();
  });

  test('throws on an unknown opcode', () => {
    expect(() => decodeIL(Buffer.from([0x24]))).toThrow(/Unknown opcode/);
  });
});
