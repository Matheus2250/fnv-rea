// The 28-byte position record (SPEC.md §5):
//   [0]  u32  location id (interior cell, or worldspace for exterior refs)
//   [4]  f32  pos x, y, z
//   [16] f32  rot x, y, z
export const RECORD_SIZE = 28;

// Coordinate bound used by SetPos and corruption checks (SPEC.md R4.3, R6.1).
export const WORLD_LIMIT = 4_096_000;

// Exterior cells are 4096 units wide (SPEC.md R6.4).
export const CELL_SHIFT = 12;

export function writePositionRecord(locationId, pos, rot) {
  const bytes = new Uint8Array(RECORD_SIZE);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, locationId >>> 0, true);
  for (let i = 0; i < 3; i++) {
    view.setFloat32(4 + i * 4, pos[i], true);
    view.setFloat32(16 + i * 4, rot[i], true);
  }
  return bytes;
}

export function readPositionRecord(bytes, offset = 0) {
  if (bytes.length - offset < RECORD_SIZE) {
    throw new RangeError(`position record needs ${RECORD_SIZE} bytes, got ${bytes.length - offset}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, RECORD_SIZE);
  const pos = [];
  const rot = [];
  for (let i = 0; i < 3; i++) {
    pos.push(view.getFloat32(4 + i * 4, true));
    rot.push(view.getFloat32(16 + i * 4, true));
  }
  return { locationId: view.getUint32(0, true), pos, rot };
}

// int(x) >> 12: truncate toward zero, then arithmetic shift (floors negatives).
export function exteriorCellCoords(x, y) {
  return [Math.trunc(x) >> CELL_SHIFT, Math.trunc(y) >> CELL_SHIFT];
}

// Design choice: the original corruption test is unknown (SPEC.md §6).
export function isCorruptLocation(pos) {
  return (
    pos.some((c) => !Number.isFinite(c)) ||
    Math.abs(pos[0]) > WORLD_LIMIT ||
    Math.abs(pos[1]) > WORLD_LIMIT
  );
}

export function isCorruptAngle(rot) {
  return rot.some((c) => !Number.isFinite(c));
}
