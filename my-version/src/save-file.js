// Our own save container (design choice, SPEC.md R5.2). Only the 28-byte
// position block inside each payload follows the observed layout.
//
//   "MYSV" u32 version u32 count
//   per record: u32 refId, u32 baseId, u32 flags, u16 payloadLength, payload
const MAGIC = 'MYSV';
const VERSION = 1;
const HEADER_SIZE = 12;
const RECORD_HEADER_SIZE = 14;

export function encodeSave(records) {
  const total = records.reduce((n, r) => n + RECORD_HEADER_SIZE + r.payload.length, HEADER_SIZE);
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < 4; i++) bytes[i] = MAGIC.charCodeAt(i);
  view.setUint32(4, VERSION, true);
  view.setUint32(8, records.length, true);

  let offset = HEADER_SIZE;
  for (const record of records) {
    if (record.payload.length > 0xffff) {
      throw new RangeError(`payload for ${record.refId} exceeds 65535 bytes`);
    }
    view.setUint32(offset, record.refId >>> 0, true);
    view.setUint32(offset + 4, record.baseId >>> 0, true);
    view.setUint32(offset + 8, record.flags >>> 0, true);
    view.setUint16(offset + 12, record.payload.length, true);
    bytes.set(record.payload, offset + RECORD_HEADER_SIZE);
    offset += RECORD_HEADER_SIZE + record.payload.length;
  }
  return bytes;
}

export function decodeSave(bytes) {
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (magic !== MAGIC) throw new Error(`not a save file (magic ${JSON.stringify(magic)})`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(4, true);
  if (version !== VERSION) throw new Error(`unsupported save version ${version}`);
  const count = view.getUint32(8, true);

  const records = [];
  let offset = HEADER_SIZE;
  for (let i = 0; i < count; i++) {
    if (offset + RECORD_HEADER_SIZE > bytes.length) throw new RangeError('truncated save record header');
    const length = view.getUint16(offset + 12, true);
    const start = offset + RECORD_HEADER_SIZE;
    if (start + length > bytes.length) throw new RangeError('truncated save record payload');
    records.push({
      refId: view.getUint32(offset, true),
      baseId: view.getUint32(offset + 4, true),
      flags: view.getUint32(offset + 8, true),
      payload: bytes.slice(start, start + length),
    });
    offset = start + length;
  }
  return records;
}
