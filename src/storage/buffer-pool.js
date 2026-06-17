const { Page } = require('./page');

/**
 * Why Pinning Matters:
 * --------------------
 * In a multi-step database operation (such as walking a B+ Tree from root to leaf, 
 * performing index lookups, or executing complex queries), page data must remain 
 * stable in memory while it is being actively processed.
 * 
 * Since the Buffer Pool has a fixed size (poolSize), reading new pages can trigger
 * eviction of older pages. Pinning a page (incrementing pinCount) guarantees that 
 * the page is marked as actively in-use and cannot be selected for eviction.
 * 
 * If a page were to be evicted mid-traversal/mid-update, its buffer memory would be 
 * overwritten by a different page's content, leading to severe memory corruption 
 * or reading wrong data. Once operations on a page are complete, the engine unpins 
 * it, marking it safe for eviction if memory space is needed.
 */
class BufferPool {
  constructor(diskManager, poolSize = 64) {
    if (!diskManager) {
      throw new Error('DiskManager is required');
    }
    this.diskManager = diskManager;
    this.poolSize = poolSize;
    this.pool = new Map(); // pageId -> Frame { page, pinCount, lastUsed }
    this.counter = 0; // Logical sequence clock for LRU tracking
  }

  newPage() {
    const pageId = this.diskManager.allocatePage();

    if (this.pool.size >= this.poolSize) {
      this._evictOne();
    }

    const page = new Page(pageId);
    const frame = {
      page,
      pinCount: 0,
      lastUsed: ++this.counter
    };

    this.pool.set(pageId, frame);
    return page;
  }

  getPage(pageId) {
    if (this.pool.has(pageId)) {
      const frame = this.pool.get(pageId);
      frame.lastUsed = ++this.counter;
      return frame.page;
    }

    // Cache miss: prepare space
    if (this.pool.size >= this.poolSize) {
      this._evictOne();
    }

    const buffer = this.diskManager.readPage(pageId);
    const page = new Page(pageId, buffer);
    const frame = {
      page,
      pinCount: 0,
      lastUsed: ++this.counter
    };

    this.pool.set(pageId, frame);
    return page;
  }

  pinPage(pageId) {
    // If the page isn't in cache, getPage will load it
    const page = this.getPage(pageId);
    const frame = this.pool.get(pageId);
    frame.pinCount++;
    frame.lastUsed = ++this.counter;
    return page;
  }

  unpinPage(pageId) {
    const frame = this.pool.get(pageId);
    if (frame) {
      frame.pinCount = Math.max(0, frame.pinCount - 1);
      frame.lastUsed = ++this.counter;
    }
  }

  flushPage(pageId) {
    const frame = this.pool.get(pageId);
    if (frame && frame.page.isDirty) {
      this.diskManager.writePage(pageId, frame.page.buffer);
      frame.page.isDirty = false;
    }
  }

  flushAll() {
    for (const pageId of this.pool.keys()) {
      this.flushPage(pageId);
    }
  }

  // --- Private Helper Methods ---

  _evictOne() {
    let oldestFrame = null;
    let oldestPageId = null;
    let minLastUsed = Infinity;

    for (const [pageId, frame] of this.pool.entries()) {
      if (frame.pinCount === 0) {
        if (frame.lastUsed < minLastUsed) {
          minLastUsed = frame.lastUsed;
          oldestFrame = frame;
          oldestPageId = pageId;
        }
      }
    }

    if (!oldestFrame) {
      throw new Error('buffer pool exhausted');
    }

    // Write page to disk if it was modified
    this.flushPage(oldestPageId);

    // Remove from active cache map
    this.pool.delete(oldestPageId);
  }
}

module.exports = BufferPool;
