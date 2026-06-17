const fs = require('fs');
const path = require('path');
const { PAGE_SIZE } = require('./page');

class DiskManager {
  constructor(dbFilePath) {
    if (!dbFilePath) {
      throw new Error('Database file path is required');
    }
    this.dbFilePath = dbFilePath;

    // Create the parent directory if it doesn't exist
    const parentDir = path.dirname(dbFilePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    // If the database file doesn't exist, create it empty
    if (!fs.existsSync(dbFilePath)) {
      fs.writeFileSync(dbFilePath, Buffer.alloc(0));
    }

    // Open the file with 'r+' mode and store the file descriptor
    this.fd = fs.openSync(dbFilePath, 'r+');
  }

  getNumPages() {
    if (this.fd === undefined) {
      throw new Error('DiskManager is closed');
    }
    const stat = fs.fstatSync(this.fd);
    return Math.floor(stat.size / PAGE_SIZE);
  }

  allocatePage() {
    if (this.fd === undefined) {
      throw new Error('DiskManager is closed');
    }
    const pageId = this.getNumPages();
    const offset = pageId * PAGE_SIZE;
    const zeroBuffer = Buffer.alloc(PAGE_SIZE);

    const bytesWritten = fs.writeSync(this.fd, zeroBuffer, 0, PAGE_SIZE, offset);
    if (bytesWritten !== PAGE_SIZE) {
      throw new Error(`Failed to allocate page ${pageId}: wrote ${bytesWritten} instead of ${PAGE_SIZE} bytes`);
    }

    return pageId;
  }

  readPage(pageId) {
    if (this.fd === undefined) {
      throw new Error('DiskManager is closed');
    }
    const buffer = Buffer.alloc(PAGE_SIZE);
    const offset = pageId * PAGE_SIZE;

    const bytesRead = fs.readSync(this.fd, buffer, 0, PAGE_SIZE, offset);
    if (bytesRead !== PAGE_SIZE) {
      throw new Error(`Short read: expected ${PAGE_SIZE} bytes but read ${bytesRead} bytes at pageId ${pageId}`);
    }

    return buffer;
  }

  writePage(pageId, buffer) {
    if (this.fd === undefined) {
      throw new Error('DiskManager is closed');
    }
    if (!Buffer.isBuffer(buffer) || buffer.length !== PAGE_SIZE) {
      throw new Error(`Buffer must be a Buffer of exactly ${PAGE_SIZE} bytes`);
    }

    const offset = pageId * PAGE_SIZE;
    const bytesWritten = fs.writeSync(this.fd, buffer, 0, PAGE_SIZE, offset);
    if (bytesWritten !== PAGE_SIZE) {
      throw new Error(`Short write: expected ${PAGE_SIZE} bytes but wrote ${bytesWritten} bytes at pageId ${pageId}`);
    }
  }

  close() {
    if (this.fd !== undefined) {
      fs.closeSync(this.fd);
      this.fd = undefined;
    }
  }
}

module.exports = DiskManager;
