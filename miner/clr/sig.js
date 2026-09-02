/**
 * ECMA-335 signature blobs — decoded only as far as the miner needs:
 * method signatures (arity + parameter/return types), field and property types,
 * generic instantiations, and custom-attribute fixed arguments.
 */

export const ET = {
  END: 0x00, VOID: 0x01, BOOLEAN: 0x02, CHAR: 0x03, I1: 0x04, U1: 0x05, I2: 0x06, U2: 0x07,
  I4: 0x08, U4: 0x09, I8: 0x0a, U8: 0x0b, R4: 0x0c, R8: 0x0d, STRING: 0x0e, PTR: 0x0f,
  BYREF: 0x10, VALUETYPE: 0x11, CLASS: 0x12, VAR: 0x13, ARRAY: 0x14, GENERICINST: 0x15,
  TYPEDBYREF: 0x16, I: 0x18, U: 0x19, FNPTR: 0x1b, OBJECT: 0x1c, SZARRAY: 0x1d, MVAR: 0x1e,
  CMOD_REQD: 0x1f, CMOD_OPT: 0x20, INTERNAL: 0x21, SENTINEL: 0x41, PINNED: 0x45,
};

const PRIMITIVE_NAMES = {
  [ET.VOID]: 'void', [ET.BOOLEAN]: 'bool', [ET.CHAR]: 'char', [ET.I1]: 'sbyte', [ET.U1]: 'byte',
  [ET.I2]: 'short', [ET.U2]: 'ushort', [ET.I4]: 'int', [ET.U4]: 'uint', [ET.I8]: 'long',
  [ET.U8]: 'ulong', [ET.R4]: 'float', [ET.R8]: 'double', [ET.STRING]: 'string', [ET.I]: 'nint',
  [ET.U]: 'nuint', [ET.OBJECT]: 'object', [ET.TYPEDBYREF]: 'TypedReference',
};

export class BlobReader {
  constructor(buf, pos = 0) {
    this.buf = buf;
    this.pos = pos;
  }
  get eof() {
    return this.pos >= this.buf.length;
  }
  u8() {
    return this.buf[this.pos++];
  }
  /** II.23.2 compressed unsigned integer. */
  cuint() {
    const b = this.buf[this.pos];
    if ((b & 0x80) === 0) {
      this.pos += 1;
      return b;
    }
    if ((b & 0xc0) === 0x80) {
      const v = ((b & 0x3f) << 8) | this.buf[this.pos + 1];
      this.pos += 2;
      return v;
    }
    const v = ((b & 0x1f) << 24) | (this.buf[this.pos + 1] << 16) | (this.buf[this.pos + 2] << 8) | this.buf[this.pos + 3];
    this.pos += 4;
    return v >>> 0;
  }
  /** II.23.2 compressed signed integer. */
  cint() {
    const start = this.pos;
    const u = this.cuint();
    const width = this.pos - start;
    const bits = width === 1 ? 7 : width === 2 ? 14 : 29;
    const sign = u & 1;
    let v = u >>> 1;
    if (sign) v -= 1 << bits;
    return v;
  }
  i32() {
    const v = this.buf.readInt32LE(this.pos);
    this.pos += 4;
    return v;
  }
  u32() {
    const v = this.buf.readUInt32LE(this.pos);
    this.pos += 4;
    return v;
  }
  u16() {
    const v = this.buf.readUInt16LE(this.pos);
    this.pos += 2;
    return v;
  }
  i64() {
    const v = this.buf.readBigInt64LE(this.pos);
    this.pos += 8;
    return v;
  }
  f32() {
    const v = this.buf.readFloatLE(this.pos);
    this.pos += 4;
    return v;
  }
  f64() {
    const v = this.buf.readDoubleLE(this.pos);
    this.pos += 8;
    return v;
  }
  /** TypeDefOrRefOrSpecEncoded → metadata token. */
  typeToken() {
    const v = this.cuint();
    const tag = v & 3;
    const rid = v >>> 2;
    const table = tag === 0 ? 0x02 : tag === 1 ? 0x01 : 0x1b;
    return (table << 24) | rid;
  }
  /** SerString used in custom attribute blobs: null (0xFF), or length-prefixed UTF-8. */
  serString() {
    if (this.buf[this.pos] === 0xff) {
      this.pos++;
      return null;
    }
    const len = this.cuint();
    const s = this.buf.subarray(this.pos, this.pos + len).toString('utf8');
    this.pos += len;
    return s;
  }
}

/**
 * Parse one Type (II.23.2.12) into a small tree:
 *   { et, name? , token?, args?, elem?, rank? }
 */
export function readType(r) {
  let et = r.u8();
  while (et === ET.CMOD_REQD || et === ET.CMOD_OPT) {
    r.typeToken();
    et = r.u8();
  }
  switch (et) {
    case ET.VALUETYPE:
    case ET.CLASS:
      return { et, token: r.typeToken() };
    case ET.PTR:
    case ET.BYREF:
    case ET.SZARRAY:
    case ET.PINNED:
      return { et, elem: readType(r) };
    case ET.VAR:
    case ET.MVAR:
      return { et, index: r.cuint() };
    case ET.GENERICINST: {
      const inner = r.u8(); // CLASS or VALUETYPE
      const token = r.typeToken();
      const n = r.cuint();
      const args = [];
      for (let i = 0; i < n; i++) args.push(readType(r));
      return { et, inner, token, args };
    }
    case ET.ARRAY: {
      const elem = readType(r);
      const rank = r.cuint();
      const nSizes = r.cuint();
      for (let i = 0; i < nSizes; i++) r.cuint();
      const nLo = r.cuint();
      for (let i = 0; i < nLo; i++) r.cint();
      return { et, elem, rank };
    }
    case ET.FNPTR:
      return { et, sig: readMethodSig(r) };
    default:
      if (et in PRIMITIVE_NAMES || et === ET.OBJECT) return { et };
      throw new Error(`Unhandled element type 0x${et.toString(16)}`);
  }
}

export const CALLCONV = { HASTHIS: 0x20, EXPLICITTHIS: 0x40, GENERIC: 0x10, VARARG: 0x05, MASK: 0x0f };

/** MethodDefSig / MethodRefSig (II.23.2.1–2). */
export function readMethodSig(r) {
  const cc = r.u8();
  const genericParams = cc & CALLCONV.GENERIC ? r.cuint() : 0;
  const paramCount = r.cuint();
  const ret = readType(r);
  const params = [];
  for (let i = 0; i < paramCount; i++) {
    if (r.buf[r.pos] === ET.SENTINEL) {
      r.pos++;
      continue;
    }
    params.push(readType(r));
  }
  return { hasThis: !!(cc & CALLCONV.HASTHIS), genericParams, ret, params };
}

export function readFieldSig(r) {
  const cc = r.u8();
  if ((cc & CALLCONV.MASK) !== 0x06) throw new Error('Not a field signature');
  return readType(r);
}

export function readPropertySig(r) {
  const cc = r.u8();
  if ((cc & CALLCONV.MASK) !== 0x08) throw new Error('Not a property signature');
  const n = r.cuint();
  const type = readType(r);
  const params = [];
  for (let i = 0; i < n; i++) params.push(readType(r));
  return { type, params };
}

/** MethodSpec instantiation (II.23.2.15): 0x0A, count, types. */
export function readMethodSpecSig(r) {
  const cc = r.u8();
  if (cc !== 0x0a) throw new Error('Not a method spec signature');
  const n = r.cuint();
  const args = [];
  for (let i = 0; i < n; i++) args.push(readType(r));
  return args;
}

/**
 * Custom attribute value (II.23.3). `ctorParams` are the constructor's parameter Type trees.
 * Enums are decoded as int32 (the only enum this miner reads, EquipType, is int-backed);
 * `resolveEnum(token)` may return 'u8' etc. to override that when known.
 */
export function readCustomAttribute(blob, ctorParams, { resolveEnum } = {}) {
  const r = new BlobReader(blob);
  if (blob.length < 2 || r.u16() !== 0x0001) return { fixed: [], named: [] };
  const readElem = (t) => {
    switch (t.et) {
      case ET.BOOLEAN: return r.u8() !== 0;
      case ET.CHAR: return String.fromCharCode(r.u16());
      case ET.I1: return (r.u8() << 24) >> 24;
      case ET.U1: return r.u8();
      case ET.I2: return (r.u16() << 16) >> 16;
      case ET.U2: return r.u16();
      case ET.I4: return r.i32();
      case ET.U4: return r.u32();
      case ET.I8: return r.i64();
      case ET.U8: return r.i64();
      case ET.R4: return r.f32();
      case ET.R8: return r.f64();
      case ET.STRING: return r.serString();
      case ET.OBJECT: {
        // Boxed: a type byte then the value. 0x55 = enum (followed by SerString type name).
        const b = r.u8();
        if (b === 0x55) {
          r.serString();
          return r.i32();
        }
        if (b === 0x50) return { typeName: r.serString() };
        return readElem({ et: b });
      }
      case ET.VALUETYPE: {
        const kind = resolveEnum?.(t.token) ?? 'i4';
        return kind === 'u8' ? r.u8() : kind === 'i2' || kind === 'u2' ? r.u16() : r.i32();
      }
      case ET.SZARRAY: {
        const n = r.u32();
        if (n === 0xffffffff) return null;
        const out = [];
        for (let i = 0; i < n; i++) out.push(readElem(t.elem));
        return out;
      }
      case ET.CLASS:
        // System.Type argument: serialised as a string.
        return { typeName: r.serString() };
      default:
        throw new Error(`Custom attribute element type 0x${t.et.toString(16)} not supported`);
    }
  };
  const fixed = ctorParams.map(readElem);
  const named = [];
  if (r.pos + 2 <= blob.length) {
    const n = r.u16();
    for (let i = 0; i < n && !r.eof; i++) {
      const kind = r.u8(); // 0x53 field, 0x54 property
      let t = { et: r.u8() };
      if (t.et === 0x55) {
        r.serString();
        t = { et: ET.I4 };
      } else if (t.et === ET.SZARRAY) {
        const inner = r.u8();
        if (inner === 0x55) r.serString();
        t = { et: ET.SZARRAY, elem: { et: inner === 0x55 ? ET.I4 : inner } };
      }
      const name = r.serString();
      named.push({ kind, name, value: readElem(t) });
    }
  }
  return { fixed, named };
}

export function primitiveName(et) {
  return PRIMITIVE_NAMES[et];
}
