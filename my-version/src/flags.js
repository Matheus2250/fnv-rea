// Change flags for placed references (SPEC.md §2).
export const ChangeFlags = Object.freeze({
  FORM_FLAGS: 0x00000001,
  MOVE: 0x00000002,
  HAVOK_MOVE: 0x00000004,
  CELL_CHANGED: 0x00000008,
  SCALE: 0x00000010,
  INVENTORY: 0x00000020,
  ANIMATION: 0x10000000,
});

// A position record exists only when one of these is set (SPEC.md §5, R5.1).
export const POSITION_MASK = ChangeFlags.MOVE | ChangeFlags.HAVOK_MOVE;

// Reference classification codes (SPEC.md §7).
export const RefClass = Object.freeze({
  NONE: 0,
  MOVED_IN_PLACE: 4,
  CREATED: 5,
  CELL_CHANGED: 6,
});

// References created during play live in this ID range (SPEC.md §7, design choice).
export const CREATED_ID_BASE = 0xff000000;

export function isCreatedId(refId) {
  return refId >>> 0 >= CREATED_ID_BASE;
}

export function hex(id) {
  return (id >>> 0).toString(16).toUpperCase().padStart(8, '0');
}
