const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { Page, PAGE_SIZE } = require('../src/storage/page');
const DiskManager = require('../src/storage/disk-manager');
const BufferPool = require('../src/storage/buffer-pool');

const testDbPath = path.join(__dirname, '..', 'data', 'test.db');

function cleanupDbFile() {
  if (fs.existsSync(testDbPath)) {
    try {
      fs.unlinkSync(testDbPath);
    } catch (e) {
      // Ignore errors during deletion if file is temporarily locked
    }
  }
}

function testPageWriteRead() {
  const page = new Page(1);
  const data = 'Hello, Slotted Page!';
  const slotIdx = page.writeSlot(data);
  const readData = page.readSlot(slotIdx);
  assert.strictEqual(readData.toString(), data);
  console.log('✓ testPageWriteRead passed');
}

function testPageFullThrows() {
  const page = new Page(1);
  // Keep writing slots until the page throws because it is full
  const chunk = 'x'.repeat(100);
  assert.throws(() => {
    while (true) {
      page.writeSlot(chunk);
    }
  }, /does not have space for record/);
  console.log('✓ testPageFullThrows passed');
}

function testDeleteSlot() {
  const page = new Page(1);
  const data = 'Delete Me';
  const slotIdx = page.writeSlot(data);
  assert.strictEqual(page.readSlot(slotIdx).toString(), data);
  
  const deleteResult = page.deleteSlot(slotIdx);
  assert.strictEqual(deleteResult, true);
  assert.strictEqual(page.readSlot(slotIdx), null);
  console.log('✓ testDeleteSlot passed');
}

function testDiskPersistence() {
  cleanupDbFile();
  
  let dm = new DiskManager(testDbPath);
  const pid = dm.allocatePage();
  
  // Write some data to a page buffer and save to disk
  const page = new Page(pid);
  page.writeSlot('Persistence Test Data');
  dm.writePage(pid, page.buffer);
  dm.close();

  // Reopen using a brand new DiskManager
  let dm2 = new DiskManager(testDbPath);
  assert.strictEqual(dm2.getNumPages(), 1);
  const readBuf = dm2.readPage(pid);
  const page2 = new Page(pid, readBuf);
  assert.strictEqual(page2.readSlot(0).toString(), 'Persistence Test Data');
  dm2.close();

  cleanupDbFile();
  console.log('✓ testDiskPersistence passed');
}

function testBufferPoolEviction() {
  cleanupDbFile();
  
  const dm = new DiskManager(testDbPath);
  const bp = new BufferPool(dm, 2); // poolSize = 2

  const p0 = bp.newPage(); // pageId 0
  const p1 = bp.newPage(); // pageId 1

  // Write data to make them dirty
  p0.writeSlot('Page 0 Content');
  p1.writeSlot('Page 1 Content');

  // Trigger eviction of page 0 by requesting page 2
  const p2 = bp.newPage(); // pageId 2
  p2.writeSlot('Page 2 Content');

  // Since page 0 was the oldest and unpinned, it must have been evicted and flushed
  assert.strictEqual(bp.pool.has(0), false);
  assert.strictEqual(bp.pool.has(1), true);
  assert.strictEqual(bp.pool.has(2), true);

  // Fetch page 0 back. Since it was evicted, it should be reloaded from disk
  const p0Reloaded = bp.getPage(0);
  assert.strictEqual(p0Reloaded.readSlot(0).toString(), 'Page 0 Content');
  assert.strictEqual(bp.pool.has(0), true);

  dm.close();
  cleanupDbFile();
  console.log('✓ testBufferPoolEviction passed');
}

function runAllTests() {
  console.log('Running Storage tests...');
  testPageWriteRead();
  testPageFullThrows();
  testDeleteSlot();
  testDiskPersistence();
  testBufferPoolEviction();
  console.log('All Storage tests passed');
}

runAllTests();
