// Small world used by the tests: one interior room and one worldspace.
export const ROOM = 0x00000100;
export const WASTELAND = 0x0000003c;
export const OTHER_ROOM = 0x00000200;

export const CAN = 0x00002000; // a tin can on the room's table
export const CHAIR = 0x00002001; // untouched furniture in the room
export const CRATE = 0x00003000; // a crate outside at (100, 200)

export const BASE_CAN = 0x00000500;
export const BASE_CHAIR = 0x00000501;
export const BASE_CRATE = 0x00000502;

export function master() {
  return {
    interiors: [ROOM, OTHER_ROOM],
    worldspaces: [WASTELAND],
    refs: [
      { id: CAN, baseId: BASE_CAN, location: { interior: ROOM }, pos: [10, 20, 30], rot: [0, 0, 0] },
      { id: CHAIR, baseId: BASE_CHAIR, location: { interior: ROOM }, pos: [50, 50, 0], rot: [0, 0, 1.5] },
      { id: CRATE, baseId: BASE_CRATE, location: { worldspace: WASTELAND }, pos: [100, 200, 5], rot: [0, 0, 0] },
    ],
  };
}

// Float32 rounding, since positions are stored as 32-bit floats.
export const f32 = (values) => values.map(Math.fround);
