// Behaviour inside one play session: leaving a cell and coming back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, ChangeFlags, FLT_MAX, interiorKey, exteriorKey } from '../src/index.js';
import { master, ROOM, WASTELAND, CAN, CHAIR, CRATE } from './fixtures.js';

const room = interiorKey(ROOM);

test('R4.1 moving an object marks MOVE', () => {
  const game = new Game(master());
  game.loadCell(room);
  const can = game.getRef(CAN);
  game.setPos(can, [11, 22, 0]);
  assert.ok(game.changes.has(CAN, ChangeFlags.MOVE));
  assert.equal(game.changes.flags(CHAIR), 0, 'untouched objects have no changes');
});

test('R4.2 rotating an object marks MOVE', () => {
  const game = new Game(master());
  game.loadCell(room);
  game.setAngle(game.getRef(CHAIR), [0, 0, 3]);
  assert.ok(game.changes.has(CHAIR, ChangeFlags.MOVE));
});

test('R4.3 absurd coordinates send the object to a safe position 10 units up', () => {
  const game = new Game(master());
  game.loadCell(room);
  const can = game.getRef(CAN);

  game.setPos(can, [5_000_000, 0, 0]);
  assert.deepEqual(can.pos, [10, 20, 40]);

  game.setPos(can, [0, -FLT_MAX, 0]);
  assert.deepEqual(can.pos, [10, 20, 40]);

  game.setPos(can, [4_096_000, -4_096_000, 7]);
  assert.deepEqual(can.pos, [4_096_000, -4_096_000, 7], 'the bound itself is allowed');
  assert.ok(game.changes.has(CAN, ChangeFlags.MOVE));
});

test('R9.3 leaving a cell keeps moved objects in memory; returning shows them where you left them', () => {
  const game = new Game(master());
  game.loadCell(room);
  const can = game.getRef(CAN);
  game.setPos(can, [12.25, 7, 0]);
  game.setAngle(can, [0, 0, 1]);

  game.unloadCell(room);
  assert.equal(can.has3D, false);
  assert.equal(game.getRef(CAN), can, 'same object stays in memory');

  game.loadCell(room);
  assert.equal(can.has3D, true);
  assert.deepEqual(can.pos, [12.25, 7, 0]);
  assert.deepEqual(can.rot, [0, 0, 1]);
});

test('R9.1/R10.1 physics snapshot is taken on unload and re-applied on reload', () => {
  const game = new Game(master());
  game.loadCell(room);
  const can = game.getRef(CAN);
  game.markHavokMoved(can, { pos: [15, 25, 1], linearVelocity: [3, 0, -1], angularVelocity: [0, 2, 0] });

  game.unloadCell(room);
  assert.deepEqual(can.savedHavok, { linearVelocity: [3, 0, -1], angularVelocity: [0, 2, 0] });
  assert.deepEqual(can.physics.linearVelocity, [0, 0, 0]);

  game.loadCell(room);
  assert.equal(can.savedHavok, null, 'snapshot is consumed');
  assert.deepEqual(can.physics, { linearVelocity: [3, 0, -1], angularVelocity: [0, 2, 0] });
  assert.deepEqual(can.pos, [15, 25, 1]);
});

test('R9.1 no snapshot for objects without HAVOK_MOVE', () => {
  const game = new Game(master());
  game.loadCell(room);
  const can = game.getRef(CAN);
  game.setPos(can, [1, 1, 1]);
  game.unloadCell(room);
  assert.equal(can.savedHavok, null);
});

test('R9.1 a second snapshot replaces the first and logs a warning', () => {
  const game = new Game(master());
  game.loadCell(room);
  const can = game.getRef(CAN);
  game.markHavokMoved(can, { linearVelocity: [1, 0, 0] });
  game.unloadCell(room);

  // Moving it into a loaded cell attaches it, consuming the snapshot; force a duplicate instead.
  can.has3D = true;
  can.physics = { linearVelocity: [9, 9, 9], angularVelocity: [0, 0, 0] };
  game.loadedCells.add(room);
  game.unloadCell(room);

  assert.deepEqual(can.savedHavok.linearVelocity, [9, 9, 9]);
  assert.ok(game.log.some((m) => m.includes('already saved havok data')));
});

test('exterior refs are placed in the 4096-unit cell containing them', () => {
  const game = new Game(master());
  const crateCell = exteriorKey(WASTELAND, 0, 0);
  game.loadCell(crateCell);
  assert.equal(game.getRef(CRATE).cellKey, crateCell);
  assert.equal(game.getRef(CAN), null, 'interior refs are not loaded');
});
