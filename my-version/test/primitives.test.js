import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ChangeFlags,
  POSITION_MASK,
  ChangesMap,
  RECORD_SIZE,
  writePositionRecord,
  readPositionRecord,
  exteriorCellCoords,
} from '../src/index.js';

test('§2 change flag values match the observed table', () => {
  assert.equal(ChangeFlags.MOVE, 0x2);
  assert.equal(ChangeFlags.HAVOK_MOVE, 0x4);
  assert.equal(ChangeFlags.CELL_CHANGED, 0x8);
  assert.equal(ChangeFlags.ANIMATION, 0x10000000);
  assert.equal(POSITION_MASK, 0x6);
});

test('§3 changes map: add ORs, set replaces, clear removes bits', () => {
  const map = new ChangesMap();
  map.add(1, ChangeFlags.MOVE);
  map.add(1, ChangeFlags.HAVOK_MOVE);
  assert.equal(map.flags(1), 0x6);
  assert.ok(map.has(1, ChangeFlags.MOVE));

  map.clear(1, ChangeFlags.MOVE);
  assert.equal(map.flags(1), ChangeFlags.HAVOK_MOVE);

  map.set(1, ChangeFlags.CELL_CHANGED, { payload: new Uint8Array(1) });
  assert.equal(map.flags(1), ChangeFlags.CELL_CHANGED);
  assert.ok(map.buffer(1));
  assert.ok(map.takeBuffer(1));
  assert.equal(map.buffer(1), null);

  assert.equal(map.flags(99), 0);
  assert.ok(map.remove(1));
  assert.equal(map.get(1), null);
});

test('§5 position record is 28 bytes: u32 location, 3×f32 pos, 3×f32 rot, little-endian', () => {
  const bytes = writePositionRecord(0x3c, [1.5, -2, 3], [0, 0.5, -1]);
  assert.equal(bytes.length, RECORD_SIZE);
  assert.deepEqual([...bytes.subarray(0, 4)], [0x3c, 0, 0, 0]);
  const view = new DataView(bytes.buffer);
  assert.equal(view.getFloat32(4, true), 1.5);
  assert.equal(view.getFloat32(16 + 8, true), -1);

  const record = readPositionRecord(bytes);
  assert.equal(record.locationId, 0x3c);
  assert.deepEqual(record.pos, [1.5, -2, 3]);
  assert.deepEqual(record.rot, [0, 0.5, -1]);
});

test('§5 position record rounds to float32', () => {
  const record = readPositionRecord(writePositionRecord(1, [0.1, 0.2, 0.3], [0, 0, 0]));
  assert.deepEqual(record.pos, [0.1, 0.2, 0.3].map(Math.fround));
});

test('§5 reading a short buffer throws', () => {
  assert.throws(() => readPositionRecord(new Uint8Array(27)), RangeError);
});

test('R6.4 exterior cells are 4096 units, truncate then floor-shift', () => {
  assert.deepEqual(exteriorCellCoords(0, 0), [0, 0]);
  assert.deepEqual(exteriorCellCoords(4095.9, 4096), [0, 1]);
  assert.deepEqual(exteriorCellCoords(-1, -0.5), [-1, 0]);
  assert.deepEqual(exteriorCellCoords(-4096, -4097), [-1, -2]);
});
