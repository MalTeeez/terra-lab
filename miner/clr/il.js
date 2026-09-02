/**
 * CIL decoder. Produces a flat instruction list:
 *   { offset, op, operand }
 * Branch operands are resolved to absolute IL offsets; `switch` yields an array of them.
 */

// operand kinds
const NONE = 0, I8 = 1, I32 = 2, I64 = 3, R4 = 4, R8 = 5, TOK = 6, BR8 = 7, BR32 = 8, SW = 9, V8 = 10, V16 = 11;

const ONE = new Array(256).fill(null);
const set = (table, code, name, kind) => { table[code] = [name, kind]; };

const one = [
  [0x00, 'nop'], [0x01, 'break'], [0x02, 'ldarg.0'], [0x03, 'ldarg.1'], [0x04, 'ldarg.2'], [0x05, 'ldarg.3'],
  [0x06, 'ldloc.0'], [0x07, 'ldloc.1'], [0x08, 'ldloc.2'], [0x09, 'ldloc.3'],
  [0x0a, 'stloc.0'], [0x0b, 'stloc.1'], [0x0c, 'stloc.2'], [0x0d, 'stloc.3'],
  [0x0e, 'ldarg.s', V8], [0x0f, 'ldarga.s', V8], [0x10, 'starg.s', V8], [0x11, 'ldloc.s', V8], [0x12, 'ldloca.s', V8], [0x13, 'stloc.s', V8],
  [0x14, 'ldnull'], [0x15, 'ldc.i4.m1'], [0x16, 'ldc.i4.0'], [0x17, 'ldc.i4.1'], [0x18, 'ldc.i4.2'], [0x19, 'ldc.i4.3'],
  [0x1a, 'ldc.i4.4'], [0x1b, 'ldc.i4.5'], [0x1c, 'ldc.i4.6'], [0x1d, 'ldc.i4.7'], [0x1e, 'ldc.i4.8'],
  [0x1f, 'ldc.i4.s', I8], [0x20, 'ldc.i4', I32], [0x21, 'ldc.i8', I64], [0x22, 'ldc.r4', R4], [0x23, 'ldc.r8', R8],
  [0x25, 'dup'], [0x26, 'pop'], [0x27, 'jmp', TOK], [0x28, 'call', TOK], [0x29, 'calli', TOK], [0x2a, 'ret'],
  [0x2b, 'br.s', BR8], [0x2c, 'brfalse.s', BR8], [0x2d, 'brtrue.s', BR8], [0x2e, 'beq.s', BR8], [0x2f, 'bge.s', BR8],
  [0x30, 'bgt.s', BR8], [0x31, 'ble.s', BR8], [0x32, 'blt.s', BR8], [0x33, 'bne.un.s', BR8], [0x34, 'bge.un.s', BR8],
  [0x35, 'bgt.un.s', BR8], [0x36, 'ble.un.s', BR8], [0x37, 'blt.un.s', BR8],
  [0x38, 'br', BR32], [0x39, 'brfalse', BR32], [0x3a, 'brtrue', BR32], [0x3b, 'beq', BR32], [0x3c, 'bge', BR32],
  [0x3d, 'bgt', BR32], [0x3e, 'ble', BR32], [0x3f, 'blt', BR32], [0x40, 'bne.un', BR32], [0x41, 'bge.un', BR32],
  [0x42, 'bgt.un', BR32], [0x43, 'ble.un', BR32], [0x44, 'blt.un', BR32], [0x45, 'switch', SW],
  [0x46, 'ldind.i1'], [0x47, 'ldind.u1'], [0x48, 'ldind.i2'], [0x49, 'ldind.u2'], [0x4a, 'ldind.i4'], [0x4b, 'ldind.u4'],
  [0x4c, 'ldind.i8'], [0x4d, 'ldind.i'], [0x4e, 'ldind.r4'], [0x4f, 'ldind.r8'], [0x50, 'ldind.ref'], [0x51, 'stind.ref'],
  [0x52, 'stind.i1'], [0x53, 'stind.i2'], [0x54, 'stind.i4'], [0x55, 'stind.i8'], [0x56, 'stind.r4'], [0x57, 'stind.r8'],
  [0x58, 'add'], [0x59, 'sub'], [0x5a, 'mul'], [0x5b, 'div'], [0x5c, 'div.un'], [0x5d, 'rem'], [0x5e, 'rem.un'],
  [0x5f, 'and'], [0x60, 'or'], [0x61, 'xor'], [0x62, 'shl'], [0x63, 'shr'], [0x64, 'shr.un'], [0x65, 'neg'], [0x66, 'not'],
  [0x67, 'conv.i1'], [0x68, 'conv.i2'], [0x69, 'conv.i4'], [0x6a, 'conv.i8'], [0x6b, 'conv.r4'], [0x6c, 'conv.r8'],
  [0x6d, 'conv.u4'], [0x6e, 'conv.u8'], [0x6f, 'callvirt', TOK], [0x70, 'cpobj', TOK], [0x71, 'ldobj', TOK],
  [0x72, 'ldstr', TOK], [0x73, 'newobj', TOK], [0x74, 'castclass', TOK], [0x75, 'isinst', TOK], [0x76, 'conv.r.un'],
  [0x79, 'unbox', TOK], [0x7a, 'throw'], [0x7b, 'ldfld', TOK], [0x7c, 'ldflda', TOK], [0x7d, 'stfld', TOK],
  [0x7e, 'ldsfld', TOK], [0x7f, 'ldsflda', TOK], [0x80, 'stsfld', TOK], [0x81, 'stobj', TOK],
  [0x82, 'conv.ovf.i1.un'], [0x83, 'conv.ovf.i2.un'], [0x84, 'conv.ovf.i4.un'], [0x85, 'conv.ovf.i8.un'],
  [0x86, 'conv.ovf.u1.un'], [0x87, 'conv.ovf.u2.un'], [0x88, 'conv.ovf.u4.un'], [0x89, 'conv.ovf.u8.un'],
  [0x8a, 'conv.ovf.i.un'], [0x8b, 'conv.ovf.u.un'], [0x8c, 'box', TOK], [0x8d, 'newarr', TOK], [0x8e, 'ldlen'],
  [0x8f, 'ldelema', TOK], [0x90, 'ldelem.i1'], [0x91, 'ldelem.u1'], [0x92, 'ldelem.i2'], [0x93, 'ldelem.u2'],
  [0x94, 'ldelem.i4'], [0x95, 'ldelem.u4'], [0x96, 'ldelem.i8'], [0x97, 'ldelem.i'], [0x98, 'ldelem.r4'],
  [0x99, 'ldelem.r8'], [0x9a, 'ldelem.ref'], [0x9b, 'stelem.i'], [0x9c, 'stelem.i1'], [0x9d, 'stelem.i2'],
  [0x9e, 'stelem.i4'], [0x9f, 'stelem.i8'], [0xa0, 'stelem.r4'], [0xa1, 'stelem.r8'], [0xa2, 'stelem.ref'],
  [0xa3, 'ldelem', TOK], [0xa4, 'stelem', TOK], [0xa5, 'unbox.any', TOK],
  [0xb3, 'conv.ovf.i1'], [0xb4, 'conv.ovf.u1'], [0xb5, 'conv.ovf.i2'], [0xb6, 'conv.ovf.u2'], [0xb7, 'conv.ovf.i4'],
  [0xb8, 'conv.ovf.u4'], [0xb9, 'conv.ovf.i8'], [0xba, 'conv.ovf.u8'], [0xc2, 'refanyval', TOK], [0xc3, 'ckfinite'],
  [0xc6, 'mkrefany', TOK], [0xd0, 'ldtoken', TOK], [0xd1, 'conv.u2'], [0xd2, 'conv.u1'], [0xd3, 'conv.i'],
  [0xd4, 'conv.ovf.i'], [0xd5, 'conv.ovf.u'], [0xd6, 'add.ovf'], [0xd7, 'add.ovf.un'], [0xd8, 'mul.ovf'],
  [0xd9, 'mul.ovf.un'], [0xda, 'sub.ovf'], [0xdb, 'sub.ovf.un'], [0xdc, 'endfinally'], [0xdd, 'leave', BR32],
  [0xde, 'leave.s', BR8], [0xdf, 'stind.i'], [0xe0, 'conv.u'],
];
for (const [c, n, k = NONE] of one) set(ONE, c, n, k);

const TWO = new Array(32).fill(null);
const two = [
  [0x00, 'arglist'], [0x01, 'ceq'], [0x02, 'cgt'], [0x03, 'cgt.un'], [0x04, 'clt'], [0x05, 'clt.un'],
  [0x06, 'ldftn', TOK], [0x07, 'ldvirtftn', TOK], [0x09, 'ldarg', V16], [0x0a, 'ldarga', V16], [0x0b, 'starg', V16],
  [0x0c, 'ldloc', V16], [0x0d, 'ldloca', V16], [0x0e, 'stloc', V16], [0x0f, 'localloc'], [0x11, 'endfilter'],
  [0x12, 'unaligned.', V8], [0x13, 'volatile.'], [0x14, 'tail.'], [0x15, 'initobj', TOK], [0x16, 'constrained.', TOK],
  [0x17, 'cpblk'], [0x18, 'initblk'], [0x19, 'no.', V8], [0x1a, 'rethrow'], [0x1c, 'sizeof', TOK],
  [0x1d, 'refanytype'], [0x1e, 'readonly.'],
];
for (const [c, n, k = NONE] of two) set(TWO, c, n, k);

/** @returns {Array<{offset:number, op:string, operand?:any}>} */
export function decodeIL(il) {
  const out = [];
  let p = 0;
  while (p < il.length) {
    const offset = p;
    let b = il[p++];
    let entry;
    if (b === 0xfe) {
      entry = TWO[il[p++]];
    } else {
      entry = ONE[b];
    }
    if (!entry) throw new Error(`Unknown opcode 0x${b.toString(16)} at IL_${offset.toString(16)}`);
    const [op, kind] = entry;
    let operand;
    switch (kind) {
      case NONE: break;
      case I8: operand = il.readInt8(p); p += 1; break;
      case V8: operand = il[p]; p += 1; break;
      case I32: operand = il.readInt32LE(p); p += 4; break;
      case TOK: operand = il.readUInt32LE(p); p += 4; break;
      case V16: operand = il.readUInt16LE(p); p += 2; break;
      case I64: operand = il.readBigInt64LE(p); p += 8; break;
      case R4: operand = il.readFloatLE(p); p += 4; break;
      case R8: operand = il.readDoubleLE(p); p += 8; break;
      case BR8: operand = il.readInt8(p) + p + 1; p += 1; break;
      case BR32: operand = il.readInt32LE(p) + p + 4; p += 4; break;
      case SW: {
        const n = il.readUInt32LE(p);
        p += 4;
        const base = p + n * 4;
        operand = [];
        for (let i = 0; i < n; i++, p += 4) operand.push(base + il.readInt32LE(p));
        break;
      }
    }
    out.push(operand === undefined ? { offset, op } : { offset, op, operand });
  }
  return out;
}

/** `ldc.i4.*` family → integer constant, else undefined. */
export function ldcValue(ins) {
  const { op, operand } = ins;
  if (op === 'ldc.i4' || op === 'ldc.i4.s') return operand;
  if (op === 'ldc.i4.m1') return -1;
  if (op.startsWith('ldc.i4.')) return Number(op.slice(7));
  return undefined;
}

export const BRANCH_OPS = new Set(
  [...one, ...two].filter(([, , k]) => k === BR8 || k === BR32).map(([, n]) => n),
);
