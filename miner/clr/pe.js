/**
 * PE image → CLI metadata streams.
 *
 * Just enough of the PE/COFF format to find the CLI header (data directory 14),
 * map RVAs onto file offsets through the section table, and slice the metadata
 * streams (`#~`, `#Strings`, `#US`, `#Blob`, `#GUID`) out of the metadata root.
 */

export function parsePE(buf) {
  if (buf.readUInt16LE(0) !== 0x5a4d) throw new Error('Not a PE image (missing MZ)');
  const peOff = buf.readUInt32LE(0x3c);
  if (buf.readUInt32LE(peOff) !== 0x00004550) throw new Error('Not a PE image (missing PE signature)');

  const coff = peOff + 4;
  const sectionCount = buf.readUInt16LE(coff + 2);
  const optSize = buf.readUInt16LE(coff + 16);
  const opt = coff + 20;
  const magic = buf.readUInt16LE(opt);
  const pe32Plus = magic === 0x20b;
  if (!pe32Plus && magic !== 0x10b) throw new Error(`Unknown optional header magic 0x${magic.toString(16)}`);
  const dirBase = opt + (pe32Plus ? 112 : 96);
  const dir = (i) => ({ rva: buf.readUInt32LE(dirBase + i * 8), size: buf.readUInt32LE(dirBase + i * 8 + 4) });

  const sections = [];
  let s = opt + optSize;
  for (let i = 0; i < sectionCount; i++, s += 40) {
    sections.push({
      name: buf.subarray(s, s + 8).toString('latin1').replace(/\0+$/, ''),
      virtualSize: buf.readUInt32LE(s + 8),
      virtualAddress: buf.readUInt32LE(s + 12),
      rawSize: buf.readUInt32LE(s + 16),
      rawPointer: buf.readUInt32LE(s + 20),
    });
  }

  const rvaToOffset = (rva) => {
    for (const sec of sections) {
      const span = Math.max(sec.virtualSize, sec.rawSize);
      if (rva >= sec.virtualAddress && rva < sec.virtualAddress + span) {
        return rva - sec.virtualAddress + sec.rawPointer;
      }
    }
    throw new Error(`RVA 0x${rva.toString(16)} is outside every section`);
  };

  const cliDir = dir(14);
  if (!cliDir.rva) throw new Error('Image has no CLI header (not a .NET assembly)');
  const cli = rvaToOffset(cliDir.rva);
  const cliHeader = {
    metadataRva: buf.readUInt32LE(cli + 8),
    metadataSize: buf.readUInt32LE(cli + 12),
    flags: buf.readUInt32LE(cli + 16),
    entryPoint: buf.readUInt32LE(cli + 20),
    resourcesRva: buf.readUInt32LE(cli + 24),
    resourcesSize: buf.readUInt32LE(cli + 28),
  };

  const md = rvaToOffset(cliHeader.metadataRva);
  if (buf.readUInt32LE(md) !== 0x424a5342) throw new Error('Bad metadata signature');
  const verLen = buf.readUInt32LE(md + 12);
  const runtimeVersion = buf.subarray(md + 16, md + 16 + verLen).toString('latin1').replace(/\0+$/, '');
  let p = md + 16 + verLen;
  const streamCount = buf.readUInt16LE(p + 2);
  p += 4;
  const streams = {};
  for (let i = 0; i < streamCount; i++) {
    const off = buf.readUInt32LE(p);
    const size = buf.readUInt32LE(p + 4);
    p += 8;
    let end = p;
    while (buf[end] !== 0) end++;
    const name = buf.subarray(p, end).toString('latin1');
    p = end + 1;
    p = (p + 3) & ~3;
    // Stream names are relative to the metadata root; keep exact slices.
    streams[name] = buf.subarray(md + off, md + off + size);
  }

  return { sections, rvaToOffset, cliHeader, runtimeVersion, streams, buf };
}
