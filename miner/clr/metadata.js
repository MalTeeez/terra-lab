/**
 * ECMA-335 metadata tables (`#~` stream) and an Assembly façade over them.
 *
 * Every table's row schema is declared so row sizes can be computed, but only the
 * tables the miner resolves are materialised into objects.
 */
import { parsePE } from './pe.js';
import { BlobReader, ET, primitiveName, readCustomAttribute, readFieldSig, readMethodSig, readMethodSpecSig, readPropertySig, readType } from './sig.js';

// Table ids
export const T = {
  Module: 0x00, TypeRef: 0x01, TypeDef: 0x02, FieldPtr: 0x03, Field: 0x04, MethodPtr: 0x05, MethodDef: 0x06,
  ParamPtr: 0x07, Param: 0x08, InterfaceImpl: 0x09, MemberRef: 0x0a, Constant: 0x0b, CustomAttribute: 0x0c,
  FieldMarshal: 0x0d, DeclSecurity: 0x0e, ClassLayout: 0x0f, FieldLayout: 0x10, StandAloneSig: 0x11,
  EventMap: 0x12, EventPtr: 0x13, Event: 0x14, PropertyMap: 0x15, PropertyPtr: 0x16, Property: 0x17,
  MethodSemantics: 0x18, MethodImpl: 0x19, ModuleRef: 0x1a, TypeSpec: 0x1b, ImplMap: 0x1c, FieldRVA: 0x1d,
  EncLog: 0x1e, EncMap: 0x1f, Assembly: 0x20, AssemblyProcessor: 0x21, AssemblyOS: 0x22, AssemblyRef: 0x23,
  AssemblyRefProcessor: 0x24, AssemblyRefOS: 0x25, File: 0x26, ExportedType: 0x27, ManifestResource: 0x28,
  NestedClass: 0x29, GenericParam: 0x2a, MethodSpec: 0x2b, GenericParamConstraint: 0x2c,
};

// Coded index definitions: [tagBits, tables...]; null = unused slot
const CI = {
  TypeDefOrRef: [2, T.TypeDef, T.TypeRef, T.TypeSpec],
  HasConstant: [2, T.Field, T.Param, T.Property],
  HasCustomAttribute: [5, T.MethodDef, T.Field, T.TypeRef, T.TypeDef, T.Param, T.InterfaceImpl, T.MemberRef, T.Module,
    T.DeclSecurity, T.Property, T.Event, T.StandAloneSig, T.ModuleRef, T.TypeSpec, T.Assembly, T.AssemblyRef, T.File,
    T.ExportedType, T.ManifestResource, T.GenericParam, T.GenericParamConstraint, T.MethodSpec],
  HasFieldMarshal: [1, T.Field, T.Param],
  HasDeclSecurity: [2, T.TypeDef, T.MethodDef, T.Assembly],
  MemberRefParent: [3, T.TypeDef, T.TypeRef, T.ModuleRef, T.MethodDef, T.TypeSpec],
  HasSemantics: [1, T.Event, T.Property],
  MethodDefOrRef: [1, T.MethodDef, T.MemberRef],
  MemberForwarded: [1, T.Field, T.MethodDef],
  Implementation: [2, T.File, T.AssemblyRef, T.ExportedType],
  CustomAttributeType: [3, null, null, T.MethodDef, T.MemberRef, null],
  ResolutionScope: [2, T.Module, T.ModuleRef, T.AssemblyRef, T.TypeRef],
  TypeOrMethodDef: [1, T.TypeDef, T.MethodDef],
};

// Column kinds: 'u8' | 'u16' | 'u32' | 'S' | 'G' | 'B' | ['idx', table] | ['ci', name]
const idx = (t) => ['idx', t];
const ci = (n) => ['ci', n];
const SCHEMA = {
  [T.Module]: [['generation', 'u16'], ['name', 'S'], ['mvid', 'G'], ['encId', 'G'], ['encBaseId', 'G']],
  [T.TypeRef]: [['scope', ci('ResolutionScope')], ['name', 'S'], ['namespace', 'S']],
  [T.TypeDef]: [['flags', 'u32'], ['name', 'S'], ['namespace', 'S'], ['extends', ci('TypeDefOrRef')], ['fieldList', idx(T.Field)], ['methodList', idx(T.MethodDef)]],
  [T.FieldPtr]: [['field', idx(T.Field)]],
  [T.Field]: [['flags', 'u16'], ['name', 'S'], ['sig', 'B']],
  [T.MethodPtr]: [['method', idx(T.MethodDef)]],
  [T.MethodDef]: [['rva', 'u32'], ['implFlags', 'u16'], ['flags', 'u16'], ['name', 'S'], ['sig', 'B'], ['paramList', idx(T.Param)]],
  [T.ParamPtr]: [['param', idx(T.Param)]],
  [T.Param]: [['flags', 'u16'], ['sequence', 'u16'], ['name', 'S']],
  [T.InterfaceImpl]: [['class', idx(T.TypeDef)], ['interface', ci('TypeDefOrRef')]],
  [T.MemberRef]: [['class', ci('MemberRefParent')], ['name', 'S'], ['sig', 'B']],
  [T.Constant]: [['type', 'u8'], ['pad', 'u8'], ['parent', ci('HasConstant')], ['value', 'B']],
  [T.CustomAttribute]: [['parent', ci('HasCustomAttribute')], ['type', ci('CustomAttributeType')], ['value', 'B']],
  [T.FieldMarshal]: [['parent', ci('HasFieldMarshal')], ['nativeType', 'B']],
  [T.DeclSecurity]: [['action', 'u16'], ['parent', ci('HasDeclSecurity')], ['permissionSet', 'B']],
  [T.ClassLayout]: [['packingSize', 'u16'], ['classSize', 'u32'], ['parent', idx(T.TypeDef)]],
  [T.FieldLayout]: [['offset', 'u32'], ['field', idx(T.Field)]],
  [T.StandAloneSig]: [['sig', 'B']],
  [T.EventMap]: [['parent', idx(T.TypeDef)], ['eventList', idx(T.Event)]],
  [T.EventPtr]: [['event', idx(T.Event)]],
  [T.Event]: [['flags', 'u16'], ['name', 'S'], ['type', ci('TypeDefOrRef')]],
  [T.PropertyMap]: [['parent', idx(T.TypeDef)], ['propertyList', idx(T.Property)]],
  [T.PropertyPtr]: [['property', idx(T.Property)]],
  [T.Property]: [['flags', 'u16'], ['name', 'S'], ['sig', 'B']],
  [T.MethodSemantics]: [['semantics', 'u16'], ['method', idx(T.MethodDef)], ['association', ci('HasSemantics')]],
  [T.MethodImpl]: [['class', idx(T.TypeDef)], ['body', ci('MethodDefOrRef')], ['declaration', ci('MethodDefOrRef')]],
  [T.ModuleRef]: [['name', 'S']],
  [T.TypeSpec]: [['sig', 'B']],
  [T.ImplMap]: [['flags', 'u16'], ['member', ci('MemberForwarded')], ['importName', 'S'], ['scope', idx(T.ModuleRef)]],
  [T.FieldRVA]: [['rva', 'u32'], ['field', idx(T.Field)]],
  [T.EncLog]: [['token', 'u32'], ['funcCode', 'u32']],
  [T.EncMap]: [['token', 'u32']],
  [T.Assembly]: [['hashAlg', 'u32'], ['major', 'u16'], ['minor', 'u16'], ['build', 'u16'], ['rev', 'u16'], ['flags', 'u32'], ['publicKey', 'B'], ['name', 'S'], ['culture', 'S']],
  [T.AssemblyProcessor]: [['processor', 'u32']],
  [T.AssemblyOS]: [['platform', 'u32'], ['major', 'u32'], ['minor', 'u32']],
  [T.AssemblyRef]: [['major', 'u16'], ['minor', 'u16'], ['build', 'u16'], ['rev', 'u16'], ['flags', 'u32'], ['publicKey', 'B'], ['name', 'S'], ['culture', 'S'], ['hash', 'B']],
  [T.AssemblyRefProcessor]: [['processor', 'u32'], ['assemblyRef', idx(T.AssemblyRef)]],
  [T.AssemblyRefOS]: [['platform', 'u32'], ['major', 'u32'], ['minor', 'u32'], ['assemblyRef', idx(T.AssemblyRef)]],
  [T.File]: [['flags', 'u32'], ['name', 'S'], ['hash', 'B']],
  [T.ExportedType]: [['flags', 'u32'], ['typeDefId', 'u32'], ['name', 'S'], ['namespace', 'S'], ['implementation', ci('Implementation')]],
  [T.ManifestResource]: [['offset', 'u32'], ['flags', 'u32'], ['name', 'S'], ['implementation', ci('Implementation')]],
  [T.NestedClass]: [['nested', idx(T.TypeDef)], ['enclosing', idx(T.TypeDef)]],
  [T.GenericParam]: [['number', 'u16'], ['flags', 'u16'], ['owner', ci('TypeOrMethodDef')], ['name', 'S']],
  [T.MethodSpec]: [['method', ci('MethodDefOrRef')], ['instantiation', 'B']],
  [T.GenericParamConstraint]: [['owner', idx(T.GenericParam)], ['constraint', ci('TypeDefOrRef')]],
};

export class Tables {
  constructor(stream) {
    this.buf = stream;
    const heapSizes = stream[6];
    this.strIdx = heapSizes & 1 ? 4 : 2;
    this.guidIdx = heapSizes & 2 ? 4 : 2;
    this.blobIdx = heapSizes & 4 ? 4 : 2;
    const valid = stream.readBigUInt64LE(8);
    this.rows = new Array(64).fill(0);
    let p = 24;
    for (let t = 0; t < 64; t++) {
      if ((valid >> BigInt(t)) & 1n) {
        this.rows[t] = stream.readUInt32LE(p);
        p += 4;
        if (!SCHEMA[t]) throw new Error(`Metadata table 0x${t.toString(16)} present but not supported`);
      }
    }
    this.layout = {};
    for (let t = 0; t < 64; t++) {
      if (!this.rows[t]) continue;
      const cols = [];
      let size = 0;
      for (const [name, kind] of SCHEMA[t]) {
        const w = this.colWidth(kind);
        cols.push({ name, kind, offset: size, width: w });
        size += w;
      }
      this.layout[t] = { cols, size, start: p };
      p += size * this.rows[t];
    }
  }

  colWidth(kind) {
    if (kind === 'u8') return 1;
    if (kind === 'u16') return 2;
    if (kind === 'u32') return 4;
    if (kind === 'S') return this.strIdx;
    if (kind === 'G') return this.guidIdx;
    if (kind === 'B') return this.blobIdx;
    if (kind[0] === 'idx') return this.rows[kind[1]] < 0x10000 ? 2 : 4;
    const [bits, ...tables] = CI[kind[1]];
    const limit = 1 << (16 - bits);
    return tables.every((t) => t === null || this.rows[t] < limit) ? 2 : 4;
  }

  read(p, width) {
    return width === 1 ? this.buf[p] : width === 2 ? this.buf.readUInt16LE(p) : this.buf.readUInt32LE(p);
  }

  /** Row `rid` (1-based) of table `t` as an object; coded indices become tokens. */
  row(t, rid) {
    const L = this.layout[t];
    if (!L || rid < 1 || rid > this.rows[t]) return null;
    const base = L.start + (rid - 1) * L.size;
    const out = { rid, token: ((t << 24) | rid) >>> 0 };
    for (const c of L.cols) {
      const v = this.read(base + c.offset, c.width);
      if (Array.isArray(c.kind) && c.kind[0] === 'ci') {
        const [bits, ...tables] = CI[c.kind[1]];
        const tag = v & ((1 << bits) - 1);
        const r = v >>> bits;
        const table = tables[tag];
        out[c.name] = table == null || r === 0 ? 0 : ((table << 24) | r) >>> 0;
      } else {
        out[c.name] = v;
      }
    }
    return out;
  }

  count(t) {
    return this.rows[t];
  }
}

export const tokenTable = (tok) => tok >>> 24;
export const tokenRid = (tok) => tok & 0xffffff;

export class Assembly {
  constructor(buffer) {
    const pe = parsePE(buffer);
    this.pe = pe;
    this.buf = buffer;
    const tablesStream = pe.streams['#~'] ?? pe.streams['#-'];
    if (!tablesStream) throw new Error('No metadata tables stream');
    this.tables = new Tables(tablesStream);
    this.strings = pe.streams['#Strings'];
    this.us = pe.streams['#US'];
    this.blobs = pe.streams['#Blob'];
    this._strCache = new Map();
    this._resolveCache = new Map();
    this._typeNameCache = new Map();
    this.name = this.tables.count(T.Assembly) ? this.string(this.tables.row(T.Assembly, 1).name) : '?';
    this._index();
  }

  string(i) {
    let s = this._strCache.get(i);
    if (s === undefined) {
      let end = i;
      while (this.strings[end] !== 0) end++;
      s = this.strings.subarray(i, end).toString('utf8');
      this._strCache.set(i, s);
    }
    return s;
  }

  blob(i) {
    const r = new BlobReader(this.blobs, i);
    const len = r.cuint();
    return this.blobs.subarray(r.pos, r.pos + len);
  }

  /** `ldstr` token → string from the #US heap. */
  userString(tok) {
    const r = new BlobReader(this.us, tok & 0xffffff);
    const len = r.cuint();
    return this.us.subarray(r.pos, r.pos + len - (len & 1)).toString('utf16le');
  }

  _index() {
    const t = this.tables;
    const nTypes = t.count(T.TypeDef);
    const nMethods = t.count(T.MethodDef);
    const nFields = t.count(T.Field);
    this.types = new Array(nTypes);
    this.methods = new Array(nMethods + 1);
    this.fields = new Array(nFields + 1);
    for (let rid = 1; rid <= nTypes; rid++) {
      const r = t.row(T.TypeDef, rid);
      this.types[rid - 1] = {
        rid, token: r.token, flags: r.flags, name: this.string(r.name), namespace: this.string(r.namespace),
        extends: r.extends, fieldList: r.fieldList, methodList: r.methodList, methods: [], fields: [], enclosing: null,
      };
    }
    for (let rid = 1; rid <= nTypes; rid++) {
      const td = this.types[rid - 1];
      const next = rid < nTypes ? this.types[rid] : null;
      const mEnd = next ? next.methodList : nMethods + 1;
      const fEnd = next ? next.fieldList : nFields + 1;
      for (let m = td.methodList; m < mEnd; m++) {
        const r = t.row(T.MethodDef, m);
        const md = { rid: m, token: r.token, rva: r.rva, flags: r.flags, implFlags: r.implFlags, name: this.string(r.name), sig: r.sig, declaringType: td };
        this.methods[m] = md;
        td.methods.push(md);
      }
      for (let f = td.fieldList; f < fEnd; f++) {
        const r = t.row(T.Field, f);
        const fd = { rid: f, token: r.token, flags: r.flags, name: this.string(r.name), sig: r.sig, declaringType: td };
        this.fields[f] = fd;
        td.fields.push(fd);
      }
    }
    for (let rid = 1; rid <= t.count(T.NestedClass); rid++) {
      const r = t.row(T.NestedClass, rid);
      this.types[r.nested - 1].enclosing = this.types[r.enclosing - 1];
    }
    for (const td of this.types) {
      td.fullName = td.enclosing ? `${td.enclosing.fullName}/${td.name}` : td.namespace ? `${td.namespace}.${td.name}` : td.name;
    }
    this.typeByName = new Map(this.types.map((td) => [td.fullName, td]));

    // Custom attributes grouped by parent token.
    this.attrsByParent = new Map();
    for (let rid = 1; rid <= t.count(T.CustomAttribute); rid++) {
      const r = t.row(T.CustomAttribute, rid);
      let list = this.attrsByParent.get(r.parent);
      if (!list) this.attrsByParent.set(r.parent, (list = []));
      list.push({ ctor: r.type, blob: r.value });
    }

    // Properties per type (needed to spot property getters/setters on Item).
    this.propsByType = new Map();
    const nProps = t.count(T.Property);
    for (let rid = 1; rid <= t.count(T.PropertyMap); rid++) {
      const r = t.row(T.PropertyMap, rid);
      const nextRow = t.row(T.PropertyMap, rid + 1);
      const end = nextRow ? nextRow.propertyList : nProps + 1;
      const list = [];
      for (let p = r.propertyList; p < end; p++) {
        const pr = t.row(T.Property, p);
        list.push({ rid: p, name: this.string(pr.name), sig: pr.sig });
      }
      this.propsByType.set(r.parent, list);
    }

    this.resources = [];
    for (let rid = 1; rid <= t.count(T.ManifestResource); rid++) {
      const r = t.row(T.ManifestResource, rid);
      if (r.implementation === 0) this.resources.push({ name: this.string(r.name), offset: r.offset });
    }
  }

  /** Bytes of an embedded manifest resource. */
  resource(name) {
    const r = this.resources.find((x) => x.name === name);
    if (!r) return null;
    const base = this.pe.rvaToOffset(this.pe.cliHeader.resourcesRva) + r.offset;
    const len = this.buf.readUInt32LE(base);
    return this.buf.subarray(base + 4, base + 4 + len);
  }

  /** Custom attributes on a token, with the attribute type's name resolved. */
  attributes(token) {
    const list = this.attrsByParent.get(token) ?? [];
    return list.map((a) => {
      const ctor = this.resolve(a.ctor);
      return { name: ctor?.declaringType?.name ?? '?', namespace: ctor?.declaringType?.namespace ?? '', ctor, blob: this.blob(a.blob) };
    });
  }

  /** Decode an attribute's fixed args via its constructor signature. */
  attributeArgs(attr) {
    const sig = attr.ctor?.sig;
    if (!sig) return { fixed: [], named: [] };
    return readCustomAttribute(attr.blob, sig.params);
  }

  /**
   * Resolve any member/type token to a descriptor:
   *  - TypeDef:   { kind:'typeDef', name, namespace, fullName, def }
   *  - TypeRef:   { kind:'typeRef', name, namespace, fullName }
   *  - TypeSpec:  { kind:'typeSpec', name (generic base name), args:[names] }
   *  - Field:     { kind:'field', name, declaringType, def }
   *  - MethodDef: { kind:'method', name, declaringType, sig, def }
   *  - MemberRef: { kind:'method'|'field', name, declaringType, sig }
   *  - MethodSpec:{ kind:'methodSpec', method, typeArgs:[names] }
   */
  resolve(token) {
    if (!token) return null;
    let d = this._resolveCache.get(token);
    if (d !== undefined) return d;
    d = this._resolve(token);
    this._resolveCache.set(token, d);
    return d;
  }

  _resolve(token) {
    const table = tokenTable(token);
    const rid = tokenRid(token);
    const t = this.tables;
    switch (table) {
      case T.TypeDef: {
        const def = this.types[rid - 1];
        return def ? { kind: 'typeDef', name: def.name, namespace: def.namespace, fullName: def.fullName, def, assembly: this.name } : null;
      }
      case T.TypeRef: {
        const r = t.row(T.TypeRef, rid);
        if (!r) return null;
        const name = this.string(r.name);
        const namespace = this.string(r.namespace);
        let fullName = namespace ? `${namespace}.${name}` : name;
        let assembly = null;
        if (tokenTable(r.scope) === T.TypeRef) {
          const outer = this.resolve(r.scope);
          fullName = `${outer.fullName}/${name}`;
          assembly = outer.assembly;
        } else if (tokenTable(r.scope) === T.AssemblyRef) {
          assembly = this.string(t.row(T.AssemblyRef, tokenRid(r.scope)).name);
        }
        return { kind: 'typeRef', name, namespace, fullName, assembly };
      }
      case T.TypeSpec: {
        const r = t.row(T.TypeSpec, rid);
        const type = readType(new BlobReader(this.blob(r.sig)));
        return { kind: 'typeSpec', name: this.typeName(type), args: type.args?.map((a) => this.typeName(a)) ?? [], type };
      }
      case T.Field: {
        const def = this.fields[rid];
        return def ? { kind: 'field', name: def.name, declaringType: this.resolve(def.declaringType.token), def } : null;
      }
      case T.MethodDef: {
        const def = this.methods[rid];
        if (!def) return null;
        return { kind: 'method', name: def.name, declaringType: this.resolve(def.declaringType.token), sig: this.methodSig(def), def };
      }
      case T.MemberRef: {
        const r = t.row(T.MemberRef, rid);
        const name = this.string(r.name);
        const blob = this.blob(r.sig);
        const declaringType = this.resolve(r.class);
        if ((blob[0] & 0x0f) === 0x06) return { kind: 'field', name, declaringType, type: readFieldSig(new BlobReader(blob)) };
        return { kind: 'method', name, declaringType, sig: readMethodSig(new BlobReader(blob)) };
      }
      case T.MethodSpec: {
        const r = t.row(T.MethodSpec, rid);
        const method = this.resolve(r.method);
        const args = readMethodSpecSig(new BlobReader(this.blob(r.instantiation)));
        return { kind: 'methodSpec', name: method?.name, declaringType: method?.declaringType, method, typeArgs: args.map((a) => this.typeName(a)), sig: method?.sig };
      }
      default:
        return null;
    }
  }

  methodSig(md) {
    if (!md._sig) md._sig = readMethodSig(new BlobReader(this.blob(md.sig)));
    return md._sig;
  }

  /**
   * Parameter names of a method def, by position. The Param rows of a method run from its own
   * `paramList` to the next method's; sequence 0 is the return value, so it is skipped.
   */
  paramNames(md) {
    if (md._params) return md._params;
    const t = this.tables;
    const n = t.count(T.MethodDef);
    const start = t.row(T.MethodDef, md.rid).paramList;
    const end = md.rid < n ? t.row(T.MethodDef, md.rid + 1).paramList : t.count(T.Param) + 1;
    const out = [];
    for (let p = start; p < end && p <= t.count(T.Param); p++) {
      const r = t.row(T.Param, p);
      if (r.sequence > 0) out[r.sequence - 1] = this.string(r.name);
    }
    md._params = out;
    return out;
  }

  fieldType(fd) {
    if (!fd._type) fd._type = readFieldSig(new BlobReader(this.blob(fd.sig)));
    return fd._type;
  }

  /** Human name for a Type tree: `Terraria.Item`, `List<int>`, `int[]`, `!0`. */
  typeName(type) {
    switch (type.et) {
      case ET.CLASS:
      case ET.VALUETYPE:
        return this.resolve(type.token)?.fullName ?? '?';
      case ET.GENERICINST: {
        const base = this.resolve(type.token)?.fullName ?? '?';
        return `${base.replace(/`\d+$/, '')}<${type.args.map((a) => this.typeName(a)).join(',')}>`;
      }
      case ET.SZARRAY:
        return `${this.typeName(type.elem)}[]`;
      case ET.ARRAY:
        return `${this.typeName(type.elem)}[${','.repeat(type.rank - 1)}]`;
      case ET.BYREF:
        return `${this.typeName(type.elem)}&`;
      case ET.PTR:
        return `${this.typeName(type.elem)}*`;
      case ET.VAR:
        return `!${type.index}`;
      case ET.MVAR:
        return `!!${type.index}`;
      default:
        return primitiveName(type.et) ?? `et${type.et}`;
    }
  }

  /** Which assembly defines a type name — this one, or the AssemblyRef a TypeRef points at. */
  assemblyOfType(fullName) {
    if (!this._asmByType) {
      this._asmByType = new Map();
      for (let rid = 1; rid <= this.tables.count(T.TypeRef); rid++) {
        const d = this.resolve(((T.TypeRef << 24) | rid) >>> 0);
        if (d?.assembly) this._asmByType.set(d.fullName, d.assembly);
      }
    }
    if (this.typeByName.has(fullName)) return this.name;
    return this._asmByType.get(fullName) ?? null;
  }

  /** Base type descriptor of a TypeDef (resolved), or null. */
  baseOf(td) {
    return td.extends ? this.resolve(td.extends) : null;
  }

  /** Simple names of the interfaces a TypeDef declares (`item.ModItem is IVoidHybrid`). */
  interfacesOf(td) {
    if (!this._ifaces) {
      this._ifaces = new Map();
      for (let rid = 1; ; rid++) {
        const r = this.tables.row(T.InterfaceImpl, rid);
        if (!r) break;
        const owner = this.types[tokenRid(r.class) - 1];
        let name = null;
        try { name = this.resolve(r.interface)?.name ?? null; } catch { /* unreadable ref */ }
        if (!owner || !name) continue;
        const l = this._ifaces.get(owner.fullName);
        if (l) l.push(name); else this._ifaces.set(owner.fullName, [name]);
      }
    }
    return this._ifaces.get(td.fullName) ?? [];
  }

  /**
   * Walk the base chain and report whether any base matches. An addon's weapons derive from the
   * mod they extend — Infernum's rogue weapons from `CalamityMod.Items.Weapons.Rogue.RogueWeapon`,
   * which is a TypeRef here — so the walk crosses into the other assembly when `siblings` has it.
   */
  derivesFrom(td, predicate, maxDepth = 32) {
    let asm = this;
    let cur = td;
    for (let i = 0; i < maxDepth && cur; i++) {
      const base = asm.baseOf(cur);
      if (!base) return false;
      if (predicate(base)) return true;
      if (base.kind === 'typeDef') { cur = base.def; continue; }
      // `class HardlightChairTile : Chair<HardlightChair>`: a generic base stands for the generic
      // type itself, which is where the ModTile is (SOTS builds all its furniture this way)
      let ref = base;
      if (base.kind === 'typeSpec') {
        try { ref = asm.resolve(base.type?.token); } catch { return false; }
        if (!ref || predicate(ref)) return !!ref;
        if (ref.kind === 'typeDef') { cur = ref.def; continue; }
      }
      const other = ref?.kind === 'typeRef' ? asm.siblings?.get(ref.assembly) : null;
      const def = other?.typeByName.get(ref.fullName);
      if (!def) return false;
      asm = other;
      cur = def;
    }
    return false;
  }

  /** Method body: { il, maxStack } or null for abstract/extern methods. */
  methodBody(md) {
    if (!md.rva) return null;
    const off = this.pe.rvaToOffset(md.rva);
    const b = this.buf;
    const first = b[off];
    if ((first & 3) === 2) {
      const size = first >> 2;
      return { il: b.subarray(off + 1, off + 1 + size), maxStack: 8 };
    }
    if ((first & 3) === 3) {
      const flags = b.readUInt16LE(off) & 0xfff;
      const headerSize = (b.readUInt16LE(off) >> 12) * 4;
      const maxStack = b.readUInt16LE(off + 2);
      const codeSize = b.readUInt32LE(off + 4);
      return { il: b.subarray(off + headerSize, off + headerSize + codeSize), maxStack, flags };
    }
    return null;
  }

  /** Raw initial data of a static field with an RVA (array initialisers), or null. */
  fieldData(fieldToken, length) {
    const t = this.tables;
    if (!this._fieldRva) {
      this._fieldRva = new Map();
      for (let rid = 1; rid <= t.count(T.FieldRVA); rid++) {
        const r = t.row(T.FieldRVA, rid);
        this._fieldRva.set(((T.Field << 24) | r.field) >>> 0, r.rva);
      }
    }
    const rva = this._fieldRva.get(fieldToken);
    if (!rva) return null;
    const off = this.pe.rvaToOffset(rva);
    return this.buf.subarray(off, off + length);
  }

  /** `const` fields of a type (ItemID, NPCID, TileID …) as name → value. */
  constants(td) {
    if (td._consts) return td._consts;
    const t = this.tables;
    const byToken = new Map(td.fields.map((f) => [f.token, f]));
    const out = new Map();
    for (let rid = 1; rid <= t.count(T.Constant); rid++) {
      const r = t.row(T.Constant, rid);
      const f = byToken.get(r.parent);
      if (!f) continue;
      const blob = this.blob(r.value);
      let v;
      switch (r.type) {
        case ET.BOOLEAN: case ET.U1: v = blob[0]; break;
        case ET.I1: v = blob.readInt8(0); break;
        case ET.CHAR: case ET.U2: v = blob.readUInt16LE(0); break;
        case ET.I2: v = blob.readInt16LE(0); break;
        case ET.I4: v = blob.readInt32LE(0); break;
        case ET.U4: v = blob.readUInt32LE(0); break;
        case ET.I8: case ET.U8: v = Number(blob.readBigInt64LE(0)); break;
        case ET.R4: v = blob.readFloatLE(0); break;
        case ET.R8: v = blob.readDoubleLE(0); break;
        case ET.STRING: v = blob.toString('utf16le'); break;
        default: continue;
      }
      out.set(f.name, v);
    }
    td._consts = out;
    return out;
  }

  propertyType(typeToken, name) {
    const p = this.propsByType.get(tokenRid(typeToken))?.find((x) => x.name === name);
    return p ? readPropertySig(new BlobReader(this.blob(p.sig))).type : null;
  }
}

export function loadAssembly(buffer) {
  return new Assembly(buffer);
}
