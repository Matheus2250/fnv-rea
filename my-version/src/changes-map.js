// Map of what changed per reference: refId -> { flags, buffer } (SPEC.md §3).
export class ChangesMap {
  #records = new Map();

  #getOrCreate(refId) {
    let record = this.#records.get(refId);
    if (!record) {
      record = { flags: 0, buffer: null };
      this.#records.set(refId, record);
    }
    return record;
  }

  get(refId) {
    return this.#records.get(refId) ?? null;
  }

  flags(refId) {
    return this.#records.get(refId)?.flags ?? 0;
  }

  has(refId, flag) {
    return (this.flags(refId) & flag) !== 0;
  }

  // flags |= value
  add(refId, value) {
    const record = this.#getOrCreate(refId);
    record.flags = (record.flags | value) >>> 0;
  }

  // flags &= ~value
  clear(refId, value) {
    const record = this.#records.get(refId);
    if (record) record.flags = (record.flags & ~value) >>> 0;
  }

  // flags = value (and optionally attach a stored buffer)
  set(refId, value, buffer = null) {
    const record = this.#getOrCreate(refId);
    record.flags = value >>> 0;
    record.buffer = buffer;
  }

  buffer(refId) {
    return this.#records.get(refId)?.buffer ?? null;
  }

  // Returns the stored buffer and detaches it from the record.
  takeBuffer(refId) {
    const record = this.#records.get(refId);
    if (!record || !record.buffer) return null;
    const { buffer } = record;
    record.buffer = null;
    return buffer;
  }

  remove(refId) {
    return this.#records.delete(refId);
  }

  entries() {
    return this.#records.entries();
  }

  get size() {
    return this.#records.size;
  }
}
