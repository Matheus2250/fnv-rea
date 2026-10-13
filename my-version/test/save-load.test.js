// Behaviour across save files: positions survive quitting the game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Game,
  ChangeFlags,
  RefClass,
  classifyRef,
  decodeSave,
  encodeSave,
  writePositionRecord,
  interiorKey,
  exteriorKey,
  isCreatedId,
} from '../src/index.js';
import { master, f32, ROOM, OTHER_ROOM, WASTELAND, CAN, CHAIR, CRATE, BASE_CAN } from './fixtures.js';

const room = interiorKey(ROOM);

function playAndSave(play) {
  const game = new Game(master());
  play(game);
  return game.saveGame();
}

test('R5.1 only refs with MOVE or HAVOK_MOVE get a position record', () => {
  const bytes = playAndSave((game) => {
    game.loadCell(room);
    game.setPos(game.getRef(CAN), [1, 2, 3]);
    game.changes.add(CHAIR, ChangeFlags.SCALE); // changed, but not moved
  });
  const records = decodeSave(bytes);
  assert.equal(records.find((r) => r.refId === CAN).payload.length, 28);
  assert.equal(records.find((r) => r.refId === CHAIR).payload.length, 0);
});

test('§5 interior refs save their cell id; exterior refs save their worldspace id', () => {
  const bytes = playAndSave((game) => {
    game.loadCell(room);
    game.loadCell(exteriorKey(WASTELAND, 0, 0));
    game.setPos(game.getRef(CAN), [1, 2, 3]);
    game.setPos(game.getRef(CRATE), [300, 400, 5]);
  });
  const view = (r) => new DataView(r.payload.buffer).getUint32(0, true);
  const records = decodeSave(bytes);
  assert.equal(view(records.find((r) => r.refId === CAN)), ROOM);
  assert.equal(view(records.find((r) => r.refId === CRATE)), WASTELAND);
});

test('R12.2 + §6: after loading a save, a moved object appears where it was when its cell loads', () => {
  const bytes = playAndSave((game) => {
    game.loadCell(room);
    game.setPos(game.getRef(CAN), [12.3, 45.6, 0.7]);
    game.setAngle(game.getRef(CAN), [0, 0, 2.1]);
  });

  const game = Game.fromSave(master(), bytes);
  assert.equal(game.getRef(CAN), null, 'not in memory until its cell loads');
  assert.ok(game.changes.buffer(CAN), 'bytes are kept as an unloaded buffer');

  game.loadCell(room);
  const can = game.getRef(CAN);
  assert.deepEqual(can.pos, f32([12.3, 45.6, 0.7]));
  assert.deepEqual(can.rot, f32([0, 0, 2.1]));
  assert.equal(game.changes.buffer(CAN), null, 'buffer is consumed');
  assert.deepEqual(game.getRef(CHAIR).pos, [50, 50, 0], 'untouched objects use editor placement');
});

test('R11.2 objects whose cell never loaded are re-saved byte-for-byte', () => {
  const first = playAndSave((game) => {
    game.loadCell(room);
    game.setPos(game.getRef(CAN), [0.1, 0.2, 0.3]);
  });
  const second = Game.fromSave(master(), first).saveGame();
  assert.deepEqual(second, first);
});

test('R11.1 objects in memory are serialized fresh, reflecting moves after loading', () => {
  const first = playAndSave((game) => {
    game.loadCell(room);
    game.setPos(game.getRef(CAN), [1, 1, 1]);
  });
  const game = Game.fromSave(master(), first);
  game.loadCell(room);
  game.setPos(game.getRef(CAN), [2, 2, 2]);

  const reloaded = Game.fromSave(master(), game.saveGame());
  reloaded.loadCell(room);
  assert.deepEqual(reloaded.getRef(CAN).pos, [2, 2, 2]);
});

test('R12.1 loading a save while the object is in memory applies it immediately', () => {
  const bytes = playAndSave((game) => {
    game.loadCell(room);
    game.setPos(game.getRef(CAN), [8, 8, 8]);
  });
  const game = new Game(master());
  game.loadCell(room);
  game.loadSave(bytes);
  assert.deepEqual(game.getRef(CAN).pos, [8, 8, 8]);
  assert.equal(game.changes.buffer(CAN), null, 'no buffer needed');
});

test('§7 classification: created, cell-changed, moved in place, none', () => {
  const game = new Game(master());
  game.loadCell(room);
  game.setPos(game.getRef(CAN), [1, 1, 1]);
  game.moveToCell(game.getRef(CHAIR), { interior: OTHER_ROOM }, [0, 0, 0]);
  const dropped = game.createRef(BASE_CAN, { interior: ROOM }, [3, 3, 3]);

  assert.equal(classifyRef(game.changes, CAN), RefClass.MOVED_IN_PLACE);
  assert.equal(classifyRef(game.changes, CHAIR), RefClass.CELL_CHANGED);
  assert.equal(classifyRef(game.changes, dropped.id), RefClass.CREATED);
  assert.equal(classifyRef(game.changes, CRATE), RefClass.NONE);
});

test('R6.3/R8.1 an object carried to another interior appears there, not in its original room', () => {
  const bytes = playAndSave((game) => {
    game.loadCell(room);
    game.moveToCell(game.getRef(CHAIR), { interior: OTHER_ROOM }, [5, 5, 0]);
  });
  const game = Game.fromSave(master(), bytes);

  game.loadCell(room);
  assert.equal(game.getRef(CHAIR), null, 'not in the original room');

  game.loadCell(interiorKey(OTHER_ROOM));
  const chair = game.getRef(CHAIR);
  assert.equal(chair.cellKey, interiorKey(OTHER_ROOM));
  assert.deepEqual(chair.pos, [5, 5, 0]);
  assert.equal(chair.has3D, true);
});

test('R6.4/R8.1 an object carried outside lands in the exterior cell computed from x, y', () => {
  const bytes = playAndSave((game) => {
    game.loadCell(room);
    game.moveToCell(game.getRef(CAN), { worldspace: WASTELAND }, [-5000, 9000, 12]);
  });
  const game = Game.fromSave(master(), bytes);
  const target = exteriorKey(WASTELAND, -2, 2);
  assert.deepEqual(game.referencesMap.get(target), [CAN]);

  game.loadCell(target);
  assert.equal(game.getRef(CAN).cellKey, target);
  assert.deepEqual(game.getRef(CAN).pos, [-5000, 9000, 12]);
});

test('R8.1 objects created during play are recreated when their cell loads', () => {
  let createdId;
  const bytes = playAndSave((game) => {
    game.loadCell(room);
    createdId = game.createRef(BASE_CAN, { interior: ROOM }, [7, 7, 7], [0, 0, 0.5]).id;
  });
  assert.ok(isCreatedId(createdId));

  const game = Game.fromSave(master(), bytes);
  game.loadCell(room);
  const dropped = game.getRef(createdId);
  assert.equal(dropped.baseId, BASE_CAN);
  assert.deepEqual(dropped.pos, [7, 7, 7]);
  assert.deepEqual(dropped.rot, f32([0, 0, 0.5]));

  const next = game.createRef(BASE_CAN, { interior: ROOM }, [0, 0, 0]);
  assert.ok(next.id > createdId, 'new IDs do not collide with loaded ones');
});

function saveWithRecord(record) {
  return encodeSave([{ baseId: BASE_CAN, ...record }]);
}

test('R6.1 a corrupt saved location falls back to the editor placement', () => {
  const payload = writePositionRecord(ROOM, [NaN, 0, 0], [0, 0, 1]);
  const game = Game.fromSave(master(), saveWithRecord({ refId: CAN, flags: ChangeFlags.MOVE, payload }));
  game.loadCell(room);
  assert.deepEqual(game.getRef(CAN).pos, [10, 20, 30]);
  assert.ok(game.log.some((m) => m.includes('Corrupt location')));
});

test('R6.2 a corrupt saved angle becomes (0, 0, 0)', () => {
  const payload = writePositionRecord(ROOM, [1, 2, 3], [0, Infinity, 0]);
  const game = Game.fromSave(master(), saveWithRecord({ refId: CAN, flags: ChangeFlags.MOVE, payload }));
  game.loadCell(room);
  assert.deepEqual(game.getRef(CAN).rot, [0, 0, 0]);
  assert.deepEqual(game.getRef(CAN).pos, [1, 2, 3]);
  assert.ok(game.log.some((m) => m.includes('Corrupt angle')));
});

test('R12.3 a record saved for a different base object is skipped', () => {
  const payload = writePositionRecord(ROOM, [1, 2, 3], [0, 0, 0]);
  const bytes = encodeSave([{ refId: CAN, baseId: 0xdead, flags: ChangeFlags.MOVE, payload }]);
  const game = Game.fromSave(master(), bytes);
  game.loadCell(room);
  assert.deepEqual(game.getRef(CAN).pos, [10, 20, 30]);
  assert.ok(game.log.some((m) => m.includes('will be skipped')));
});

test('R8.1 a pending reference without a buffer logs the "no unloaded buffer" error', () => {
  const game = new Game(master());
  game.changes.add(CHAIR, ChangeFlags.CELL_CHANGED);
  game.referencesMap.set(room, [CHAIR]);
  game.loadCell(room);
  assert.ok(game.log.some((m) => m.includes('no unloaded buffer')));
});

test('R8.1 a pending reference that is neither created nor cell-changed is rejected', () => {
  const game = new Game(master());
  game.changes.set(CAN, ChangeFlags.MOVE, { baseId: BASE_CAN, payload: new Uint8Array(0) });
  game.referencesMap.set(interiorKey(OTHER_ROOM), [CAN]);
  game.loadCell(interiorKey(OTHER_ROOM));
  assert.ok(game.log.some((m) => m.includes('neither a created reference or a moved reference')));
});

test('a location id that is neither a known cell nor worldspace is reported', () => {
  const payload = writePositionRecord(0x999, [1, 2, 3], [0, 0, 0]);
  const game = Game.fromSave(master(), saveWithRecord({ refId: CAN, flags: ChangeFlags.MOVE, payload }));
  game.loadCell(room);
  assert.ok(game.log.some((m) => m.includes('Could not find cell or worldspace')));
});

test('decodeSave rejects garbage and truncated files', () => {
  assert.throws(() => decodeSave(new Uint8Array([1, 2, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0])), /not a save file/);
  const good = playAndSave((game) => {
    game.loadCell(room);
    game.setPos(game.getRef(CAN), [1, 1, 1]);
  });
  assert.throws(() => decodeSave(good.subarray(0, good.length - 1)), RangeError);
});
