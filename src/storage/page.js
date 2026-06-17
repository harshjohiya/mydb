const PAGE_SIZE = 4096;

/**
 * Slotted Page Layout Explanation:
 * --------------------------------
 * In a database storage engine, a page needs to support storing variable-length records,
 * direct lookups via record IDs, and deletions/updates without excessive fragmentation.
 * 
 * The "slotted page" layout solves this by dividing the page into three areas:
 * 
 * 1. Header (Fixed Size, 8 bytes):
 *    At the very start of the page. Stores metadata: the number of slots (numSlots)
 *    and a pointer to the start of the free space (freeSpacePointer).
 * 
 * 2. Slot Directory (Grows Forward):
 *    Starts immediately after the header. Each slot is fixed-size (8 bytes total: 4-byte offset,
 *    4-byte length). Since the slot index (0, 1, 2...) is stable, external references
 *    (Record IDs / Tuple IDs) can point to (pageId, slotIndex) without changing even if the
 *    underlying record data is reorganized or moved within the page.
 * 
 * 3. Record Data Area (Grows Backward):
 *    Record data is written starting from the end of the page (offset PAGE_SIZE) and grows
 *    backwards towards the front.
 * 
 * 4. Free Space (In the Middle):
 *    The space between the end of the slot directory and the start of the record data.
 *    As new slots are added, the slot directory grows forward and the record data grows
 *    backward. The free space is simply the gap between them.
 * 
 * 5. Deletions (Tombstoning):
 *    When a record is deleted, its directory entry length is set to 0. This is a "tombstone".
 *    It preserves the slotIndex so that other slot indexes do not shift, which ensures
 *    Record IDs remain valid.
 */
class Page {
  constructor(pageId, buffer) {
    if (pageId === undefined || pageId === null) {
      throw new Error('pageId is required');
    }
    this.pageId = pageId;
    this.isDirty = false;

    if (buffer !== undefined) {
      if (!Buffer.isBuffer(buffer) || buffer.length !== PAGE_SIZE) {
        throw new Error(`Buffer must be a Buffer of exactly ${PAGE_SIZE} bytes`);
      }
      this.buffer = buffer;
    } else {
      this.buffer = Buffer.alloc(PAGE_SIZE);
      this.setNumSlots(0);
      this.setFreeSpacePointer(PAGE_SIZE);
    }
  }

  // --- Helper Methods ---

  getNumSlots() {
    return this.buffer.readUInt32LE(0);
  }

  setNumSlots(val) {
    this.buffer.writeUInt32LE(val, 0);
  }

  getFreeSpacePointer() {
    return this.buffer.readUInt32LE(4);
  }

  setFreeSpacePointer(val) {
    this.buffer.writeUInt32LE(val, 4);
  }

  // --- Public Interface ---

  getFreeSpace() {
    const numSlots = this.getNumSlots();
    const freeSpacePointer = this.getFreeSpacePointer();
    const slotDirEnd = 8 + numSlots * 8;
    return Math.max(0, freeSpacePointer - slotDirEnd);
  }

  hasSpaceFor(dataLength) {
    // A new slot requires 8 bytes for the directory entry + dataLength bytes for the data
    return this.getFreeSpace() >= (8 + dataLength);
  }

  writeSlot(data) {
    const dataBuffer = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
    if (!Buffer.isBuffer(dataBuffer)) {
      throw new Error('Data must be a Buffer or a string');
    }

    const dataLength = dataBuffer.length;
    const needed = 8 + dataLength;
    const available = this.getFreeSpace();

    if (available < needed) {
      throw new Error(
        `Page ${this.pageId} does not have space for record. Needed: ${needed} bytes, Available: ${available} bytes.`
      );
    }

    const numSlots = this.getNumSlots();
    const freeSpacePointer = this.getFreeSpacePointer();

    // Data grows backwards from the current freeSpacePointer
    const newFreeSpacePointer = freeSpacePointer - dataLength;

    // Write record data into the buffer
    dataBuffer.copy(this.buffer, newFreeSpacePointer);

    // Write slot directory entry at offset (8 + numSlots * 8)
    const slotOffset = 8 + numSlots * 8;
    this.buffer.writeUInt32LE(newFreeSpacePointer, slotOffset);
    this.buffer.writeUInt32LE(dataLength, slotOffset + 4);

    // Update page header
    this.setNumSlots(numSlots + 1);
    this.setFreeSpacePointer(newFreeSpacePointer);

    this.isDirty = true;
    return numSlots;
  }

  readSlot(slotIndex) {
    const numSlots = this.getNumSlots();
    if (slotIndex < 0 || slotIndex >= numSlots) {
      return null;
    }

    const slotOffset = 8 + slotIndex * 8;
    const offset = this.buffer.readUInt32LE(slotOffset);
    const length = this.buffer.readUInt32LE(slotOffset + 4);

    if (length === 0) {
      return null; // Tombstoned/deleted slot
    }

    return this.buffer.subarray(offset, offset + length);
  }

  deleteSlot(slotIndex) {
    const numSlots = this.getNumSlots();
    if (slotIndex < 0 || slotIndex >= numSlots) {
      return false;
    }

    const slotOffset = 8 + slotIndex * 8;
    const length = this.buffer.readUInt32LE(slotOffset + 4);

    if (length === 0) {
      return false; // Already deleted
    }

    // Tombstone the slot by zeroing out the entry
    this.buffer.writeUInt32LE(0, slotOffset);
    this.buffer.writeUInt32LE(0, slotOffset + 4);

    this.isDirty = true;
    return true;
  }

  getAllSlots() {
    const list = [];
    const numSlots = this.getNumSlots();
    for (let i = 0; i < numSlots; i++) {
      const data = this.readSlot(i);
      if (data !== null) {
        list.push({ slotIndex: i, data });
      }
    }
    return list;
  }
}

module.exports = {
  Page,
  PAGE_SIZE
};
