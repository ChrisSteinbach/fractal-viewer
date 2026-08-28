/** A tiny insertion-ordered LRU map with an explicit entry cap. */
export class LruMap<K, V> {
  private readonly entries = new Map<K, V>();

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError("LRU capacity must be a positive integer");
    }
  }

  get size(): number {
    return this.entries.size;
  }

  has(key: K): boolean {
    return this.entries.has(key);
  }

  /** Read and refresh one entry. */
  get(key: K): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined && !this.entries.has(key)) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value as V);
    return value;
  }

  /** Refresh an existing entry without reading its value. */
  touch(key: K): boolean {
    const value = this.entries.get(key);
    if (value === undefined && !this.entries.has(key)) return false;
    this.entries.delete(key);
    this.entries.set(key, value as V);
    return true;
  }

  /** Insert or refresh one entry, evicting the least-recently-used entries. */
  set(key: K, value: V): this {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
    return this;
  }

  clear(): void {
    this.entries.clear();
  }

  keys(): IterableIterator<K> {
    return this.entries.keys();
  }
}
