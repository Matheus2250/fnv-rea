import { ChangeFlags, POSITION_MASK, RefClass, CREATED_ID_BASE, isCreatedId, hex } from './flags.js';
import { ChangesMap } from './changes-map.js';
import {
  RECORD_SIZE,
  WORLD_LIMIT,
  writePositionRecord,
  readPositionRecord,
  exteriorCellCoords,
  isCorruptLocation,
  isCorruptAngle,
} from './position-record.js';
import { encodeSave, decodeSave } from './save-file.js';

export const FLT_MAX = 3.4028234663852886e38;
// Height added when SetPos rejects a coordinate (SPEC.md R4.3).
export const SAFE_POSITION_LIFT = 10;

const EMPTY = new Uint8Array(0);
const ZERO_PHYSICS = Object.freeze({ linearVelocity: [0, 0, 0], angularVelocity: [0, 0, 0] });

export function interiorKey(cellId) {
  return `I:${cellId >>> 0}`;
}

export function exteriorKey(worldspaceId, cx, cy) {
  return `E:${worldspaceId >>> 0}:${cx}:${cy}`;
}

export function parseCellKey(key) {
  const parts = key.split(':');
  if (parts[0] === 'I') return { interior: Number(parts[1]) };
  if (parts[0] === 'E') return { worldspace: Number(parts[1]), cx: Number(parts[2]), cy: Number(parts[3]) };
  throw new Error(`bad cell key ${key}`);
}

export function classifyRef(changes, refId) {
  if (isCreatedId(refId)) return RefClass.CREATED;
  const flags = changes.flags(refId);
  if (flags & ChangeFlags.CELL_CHANGED) return RefClass.CELL_CHANGED;
  if (flags & POSITION_MASK) return RefClass.MOVED_IN_PLACE;
  return RefClass.NONE;
}

function copyPhysics(physics) {
  return { linearVelocity: [...physics.linearVelocity], angularVelocity: [...physics.angularVelocity] };
}

function isAbsurd(pos) {
  return (
    pos.some((c) => Math.abs(c) >= FLT_MAX || !Number.isFinite(c)) ||
    Math.abs(pos[0]) > WORLD_LIMIT ||
    Math.abs(pos[1]) > WORLD_LIMIT
  );
}

// Master data plays the role of the game's plugin files: editor placements
// that every new session starts from.
//
// master = {
//   interiors: [cellId, ...],
//   worldspaces: [worldspaceId, ...],
//   refs: [{ id, baseId, location: { interior } | { worldspace }, pos, rot }],
// }
export class Game {
  constructor(master) {
    this.interiors = new Set(master.interiors ?? []);
    this.worldspaces = new Set(master.worldspaces ?? []);
    this.masterRefs = new Map();
    for (const m of master.refs ?? []) {
      const cellKey = this.cellKeyFor(m.location, m.pos);
      this.masterRefs.set(m.id >>> 0, {
        id: m.id >>> 0,
        baseId: m.baseId >>> 0,
        cellKey,
        pos: [...m.pos],
        rot: [...(m.rot ?? [0, 0, 0])],
      });
    }

    this.changes = new ChangesMap();
    this.refs = new Map();
    this.loadedCells = new Set();
    // Destination cell -> created / cell-changed refs waiting for that cell (SPEC.md §8).
    this.referencesMap = new Map();
    this.log = [];
    this.nextCreatedId = CREATED_ID_BASE + 1;
  }

  static fromSave(master, bytes) {
    const game = new Game(master);
    game.loadSave(bytes);
    return game;
  }

  cellKeyFor(location, pos) {
    if (location.interior !== undefined) return interiorKey(location.interior);
    const [cx, cy] = exteriorCellCoords(pos[0], pos[1]);
    return exteriorKey(location.worldspace, cx, cy);
  }

  getRef(refId) {
    return this.refs.get(refId >>> 0) ?? null;
  }

  // ---- Cell lifecycle -------------------------------------------------------

  // Entering (or returning to) a cell builds its 3D (SPEC.md §8, §10).
  loadCell(cellKey) {
    if (this.loadedCells.has(cellKey)) return;
    this.loadedCells.add(cellKey);

    for (const master of this.masterRefs.values()) {
      if (master.cellKey !== cellKey || this.refs.has(master.id)) continue;
      // A ref that changed cell shows up at its destination instead.
      if (this.changes.has(master.id, ChangeFlags.CELL_CHANGED)) continue;
      const ref = this.#instantiate(master);
      const buffer = this.changes.takeBuffer(ref.id);
      if (buffer) this.#restorePosition(ref, this.changes.flags(ref.id), buffer.payload);
    }

    const pending = this.referencesMap.get(cellKey);
    if (pending) {
      this.referencesMap.delete(cellKey);
      for (const refId of pending) this.#restoreFromReferencesMap(refId);
    }

    for (const ref of this.refs.values()) {
      if (ref.cellKey === cellKey) this.#attach3D(ref);
    }
  }

  // Leaving a cell removes the 3D of its refs; the refs stay in memory (SPEC.md §9).
  unloadCell(cellKey) {
    if (!this.loadedCells.delete(cellKey)) return;
    for (const ref of this.refs.values()) {
      if (ref.cellKey === cellKey && ref.has3D) this.#detach3D(ref);
    }
  }

  // ---- Mutations that mark changes (SPEC.md §4) ------------------------------

  setPos(ref, pos) {
    if (isAbsurd(pos)) {
      const [x, y, z] = ref.editor.pos;
      ref.pos = [x, y, z + SAFE_POSITION_LIFT];
    } else {
      ref.pos = [...pos];
    }
    this.changes.add(ref.id, ChangeFlags.MOVE);
  }

  setAngle(ref, rot) {
    ref.rot = [...rot];
    this.changes.add(ref.id, ChangeFlags.MOVE);
  }

  // Physics moved the object (SPEC.md R4.5: explicit in our version).
  markHavokMoved(ref, { pos, linearVelocity = [0, 0, 0], angularVelocity = [0, 0, 0] } = {}) {
    if (pos) ref.pos = [...pos];
    ref.physics = { linearVelocity: [...linearVelocity], angularVelocity: [...angularVelocity] };
    this.changes.add(ref.id, ChangeFlags.HAVOK_MOVE);
  }

  moveToCell(ref, location, pos, rot = ref.rot) {
    ref.cellKey = this.cellKeyFor(location, pos);
    ref.pos = [...pos];
    ref.rot = [...rot];
    this.changes.add(ref.id, ChangeFlags.MOVE | ChangeFlags.CELL_CHANGED);
    if (this.loadedCells.has(ref.cellKey)) this.#attach3D(ref);
    else if (ref.has3D) this.#detach3D(ref);
  }

  createRef(baseId, location, pos, rot = [0, 0, 0]) {
    const id = this.nextCreatedId++ >>> 0;
    const cellKey = this.cellKeyFor(location, pos);
    const ref = this.#instantiate({ id, baseId: baseId >>> 0, cellKey, pos, rot });
    this.changes.add(id, ChangeFlags.MOVE);
    if (this.loadedCells.has(cellKey)) this.#attach3D(ref);
    return ref;
  }

  // ---- Save / load (SPEC.md §11, §12) ----------------------------------------

  saveGame() {
    const records = [];
    for (const [refId, record] of this.changes.entries()) {
      const ref = this.refs.get(refId);
      if (ref) {
        const payload =
          record.flags & POSITION_MASK
            ? writePositionRecord(this.#locationIdOf(ref.cellKey), ref.pos, ref.rot)
            : EMPTY;
        records.push({ refId, baseId: ref.baseId, flags: record.flags, payload });
      } else if (record.buffer) {
        // Not in memory: copy the stored bytes verbatim (R11.2).
        records.push({ refId, baseId: record.buffer.baseId, flags: record.flags, payload: record.buffer.payload });
      } else {
        const master = this.masterRefs.get(refId);
        records.push({ refId, baseId: master?.baseId ?? 0, flags: record.flags, payload: EMPTY });
      }
    }
    return encodeSave(records);
  }

  loadSave(bytes) {
    for (const record of decodeSave(bytes)) {
      const { refId, baseId, flags, payload } = record;
      const created = isCreatedId(refId);

      if (created) {
        this.nextCreatedId = Math.max(this.nextCreatedId, refId + 1);
      } else {
        const master = this.masterRefs.get(refId);
        if (!master) {
          this.#warn(`SAVELOAD: Form ${hex(refId)} not found in master data. Its loading will be skipped.`);
          continue;
        }
        if (master.baseId !== baseId) {
          this.#warn(
            `SAVELOAD: Form ${hex(refId)} was saved with base ${hex(baseId)}, but currently has base ` +
              `${hex(master.baseId)}. Its loading will be skipped.`,
          );
          continue;
        }
      }

      const ref = this.refs.get(refId);
      if (ref) {
        // In memory: apply now (R12.1).
        this.changes.set(refId, flags);
        this.#restorePosition(ref, flags, payload);
        if (this.loadedCells.has(ref.cellKey)) this.#attach3D(ref);
        else if (ref.has3D) this.#detach3D(ref);
        continue;
      }

      // Not in memory: keep the bytes until the ref's cell loads (R12.2).
      this.changes.set(refId, flags, { baseId, payload });
      if (created || flags & ChangeFlags.CELL_CHANGED) {
        const destination = this.#destinationOf(refId, flags, payload);
        if (destination) {
          if (!this.referencesMap.has(destination)) this.referencesMap.set(destination, []);
          this.referencesMap.get(destination).push(refId);
        }
      }
    }
  }

  // ---- Internals -------------------------------------------------------------

  #instantiate({ id, baseId, cellKey, pos, rot }) {
    const ref = {
      id,
      baseId,
      editor: { cellKey, pos: [...pos], rot: [...rot] },
      cellKey,
      pos: [...pos],
      rot: [...rot],
      has3D: false,
      physics: copyPhysics(ZERO_PHYSICS),
      savedHavok: null,
    };
    this.refs.set(id, ref);
    return ref;
  }

  #attach3D(ref) {
    if (ref.has3D) return;
    ref.has3D = true;
    if (ref.savedHavok) {
      ref.physics = ref.savedHavok;
      ref.savedHavok = null;
    }
  }

  #detach3D(ref) {
    ref.has3D = false;
    if (this.changes.has(ref.id, ChangeFlags.HAVOK_MOVE)) {
      if (ref.savedHavok) {
        this.#warn('SAVELOAD: SetSavedHavokData() is being called when there is already saved havok data.');
      }
      ref.savedHavok = copyPhysics(ref.physics);
      ref.physics = copyPhysics(ZERO_PHYSICS);
    }
  }

  #restoreFromReferencesMap(refId) {
    const kind = classifyRef(this.changes, refId);
    if (kind !== RefClass.CREATED && kind !== RefClass.CELL_CHANGED) {
      this.#warn(`SAVELOAD: Ref ${hex(refId)} is in the references map but is neither a created reference or a moved reference`);
      return;
    }
    const buffer = this.changes.takeBuffer(refId);
    if (!buffer) {
      this.#warn(`SAVELOAD: Ref ${hex(refId)} is in the references map but there is no unloaded buffer for it in the changes map`);
      return;
    }

    let ref = this.refs.get(refId);
    if (!ref) {
      const master = this.masterRefs.get(refId);
      if (kind === RefClass.CREATED) {
        const { pos, rot } = readPositionRecord(buffer.payload);
        ref = this.#instantiate({ id: refId, baseId: buffer.baseId, cellKey: '', pos, rot });
      } else if (master) {
        ref = this.#instantiate(master);
      } else {
        this.#warn(`SAVELOAD: Ref ${hex(refId)} has no master data.`);
        return;
      }
    }
    this.#restorePosition(ref, this.changes.flags(refId), buffer.payload);
    if (kind === RefClass.CREATED) ref.editor = { cellKey: ref.cellKey, pos: [...ref.pos], rot: [...ref.rot] };
  }

  // SPEC.md §6
  #restorePosition(ref, flags, payload) {
    if ((flags & POSITION_MASK) === 0 || payload.length < RECORD_SIZE) return;
    const record = readPositionRecord(payload);

    let rot = record.rot;
    if (isCorruptAngle(rot)) {
      this.#warn(`SAVELOAD: Corrupt angle found loading reference ${hex(ref.id)}, setting to (0, 0, 0).`);
      rot = [0, 0, 0];
    }

    let pos = record.pos;
    let cellKey;
    if (isCorruptLocation(pos)) {
      this.#warn(`SAVELOAD: Corrupt location found loading reference ${hex(ref.id)}, fixing it.`);
      pos = [...ref.editor.pos];
      cellKey = ref.editor.cellKey;
    } else {
      cellKey = this.#resolveLocation(record.locationId, pos);
      if (!cellKey) {
        this.#warn(`CELLS: Could not find cell or worldspace ${hex(record.locationId)} for moved reference ${hex(ref.id)}`);
        return;
      }
    }

    ref.pos = pos;
    ref.rot = rot;
    ref.cellKey = cellKey;
  }

  #destinationOf(refId, flags, payload) {
    if ((flags & POSITION_MASK) === 0 || payload.length < RECORD_SIZE) {
      this.#warn(`SAVELOAD: Ref ${hex(refId)} has no position record to find its cell.`);
      return null;
    }
    const { locationId, pos } = readPositionRecord(payload);
    const cellKey = this.#resolveLocation(locationId, pos);
    if (!cellKey) {
      this.#warn(`CELLS: Could not find cell or worldspace ${hex(locationId)} for moved reference ${hex(refId)}`);
    }
    return cellKey;
  }

  #resolveLocation(locationId, pos) {
    if (this.interiors.has(locationId)) return interiorKey(locationId);
    if (this.worldspaces.has(locationId)) return this.cellKeyFor({ worldspace: locationId }, pos);
    return null;
  }

  // Interior refs save their cell; exterior refs save their worldspace (SPEC.md §5).
  #locationIdOf(cellKey) {
    const parsed = parseCellKey(cellKey);
    return parsed.interior ?? parsed.worldspace;
  }

  #warn(message) {
    this.log.push(message);
  }
}
