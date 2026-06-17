const assert = require('assert');
const { Page, PAGE_SIZE } = require('../src/storage/page');

function runTests() {
  console.log('Running tests for Page class...');

  // 1. Initial State
  const page1 = new Page(42);
  assert.strictEqual(page1.pageId, 42);
  assert.strictEqual(page1.getNumSlots(), 0);
  assert.strictEqual(page1.getFreeSpacePointer(), PAGE_SIZE);
  // Free space should be PAGE_SIZE - header (8) = 4088
  assert.strictEqual(page1.getFreeSpace(), 4088);
  assert.strictEqual(page1.isDirty, false);
  console.log('✓ Initial State tests passed');

  // 2. Write Slot
  const data1 = 'Hello World'; // 11 bytes
  const slot0 = page1.writeSlot(data1);
  assert.strictEqual(slot0, 0);
  assert.strictEqual(page1.getNumSlots(), 1);
  assert.strictEqual(page1.isDirty, true);
  // dataLength = 11, so freeSpacePointer should be 4096 - 11 = 4085
  assert.strictEqual(page1.getFreeSpacePointer(), 4085);
  // slotDirEnd is 8 + 1 * 8 = 16. Free space = 4085 - 16 = 4069
  assert.strictEqual(page1.getFreeSpace(), 4069);
  console.log('✓ Write Slot tests passed');

  // 3. Read Slot
  const readVal1 = page1.readSlot(0);
  assert.strictEqual(readVal1.toString(), 'Hello World');
  assert.strictEqual(page1.readSlot(1), null); // Out of bounds
  assert.strictEqual(page1.readSlot(-1), null); // Invalid index
  console.log('✓ Read Slot tests passed');

  // 4. Space Checks & Overflow Error
  const data2 = 'x'.repeat(4065); // 4065 bytes
  // Needs 8 + 4065 = 4073 bytes. Available = 4069. So it shouldn't fit.
  assert.strictEqual(page1.hasSpaceFor(4065), false);
  assert.throws(() => {
    page1.writeSlot(data2);
  }, /does not have space for record/);
  console.log('✓ Space Check and Overflow tests passed');

  // 5. Multiple Writes
  const data3 = 'Second Record!'; // 14 bytes. Needs 8 + 14 = 22 bytes. Available = 4069.
  assert.strictEqual(page1.hasSpaceFor(14), true);
  const slot1 = page1.writeSlot(data3);
  assert.strictEqual(slot1, 1);
  assert.strictEqual(page1.getNumSlots(), 2);
  // freeSpacePointer should be 4085 - 14 = 4071
  assert.strictEqual(page1.getFreeSpacePointer(), 4071);
  // slotDirEnd is 8 + 2 * 8 = 24. Free space = 4071 - 24 = 4047
  assert.strictEqual(page1.getFreeSpace(), 4047);
  assert.strictEqual(page1.readSlot(1).toString(), 'Second Record!');
  console.log('✓ Multiple Writes tests passed');

  // 6. Get All Slots
  const allSlots = page1.getAllSlots();
  assert.strictEqual(allSlots.length, 2);
  assert.strictEqual(allSlots[0].slotIndex, 0);
  assert.strictEqual(allSlots[0].data.toString(), 'Hello World');
  assert.strictEqual(allSlots[1].slotIndex, 1);
  assert.strictEqual(allSlots[1].data.toString(), 'Second Record!');
  console.log('✓ Get All Slots tests passed');

  // 7. Delete Slot (Tombstone)
  // Deleting slot 0
  page1.isDirty = false;
  const deleted = page1.deleteSlot(0);
  assert.strictEqual(deleted, true);
  assert.strictEqual(page1.isDirty, true);
  assert.strictEqual(page1.readSlot(0), null); // Should return null because it's tombstoned
  // Deleting again should return false
  assert.strictEqual(page1.deleteSlot(0), false);
  // Deleting out of bounds should return false
  assert.strictEqual(page1.deleteSlot(2), false);

  // Free space shouldn't increase because space isn't reclaimed on deletion
  assert.strictEqual(page1.getFreeSpace(), 4047);

  // getAllSlots should now only return slot 1
  const allSlotsAfterDelete = page1.getAllSlots();
  assert.strictEqual(allSlotsAfterDelete.length, 1);
  assert.strictEqual(allSlotsAfterDelete[0].slotIndex, 1);
  assert.strictEqual(allSlotsAfterDelete[0].data.toString(), 'Second Record!');
  console.log('✓ Delete Slot tests passed');

  // 8. Wrap Existing Buffer
  const page2 = new Page(42, page1.buffer);
  assert.strictEqual(page2.getNumSlots(), 2);
  assert.strictEqual(page2.readSlot(0), null); // Tombstoned
  assert.strictEqual(page2.readSlot(1).toString(), 'Second Record!');
  assert.strictEqual(page2.getFreeSpace(), 4047);
  console.log('✓ Wrap Existing Buffer tests passed');

  // --- DiskManager Tests ---
  console.log('Running tests for DiskManager class...');
  const fs = require('fs');
  const DiskManager = require('../src/storage/disk-manager');
  const dbFile = './test_temp.db';

  // Clean up previous runs if any
  if (fs.existsSync(dbFile)) {
    fs.unlinkSync(dbFile);
  }

  const dm = new DiskManager(dbFile);
  assert.strictEqual(dm.getNumPages(), 0);

  // Allocate first page
  const pid0 = dm.allocatePage();
  assert.strictEqual(pid0, 0);
  assert.strictEqual(dm.getNumPages(), 1);

  // Verify it was initialized to zeroed bytes
  const p0Buf = dm.readPage(0);
  assert.deepStrictEqual(p0Buf, Buffer.alloc(PAGE_SIZE));

  // Write some data to page 0
  const writeBuf = Buffer.alloc(PAGE_SIZE, 'A');
  dm.writePage(0, writeBuf);

  // Read page 0 back
  const p0BufRead = dm.readPage(0);
  assert.deepStrictEqual(p0BufRead, writeBuf);

  // Error cases
  assert.throws(() => {
    dm.readPage(1); // Short read
  }, /Short read/);

  assert.throws(() => {
    dm.writePage(0, Buffer.alloc(100)); // Invalid buffer length
  }, /Buffer must be a Buffer of exactly/);

  // Persistence check
  dm.close();

  const dm2 = new DiskManager(dbFile);
  assert.strictEqual(dm2.getNumPages(), 1);
  const p0BufRead2 = dm2.readPage(0);
  assert.deepStrictEqual(p0BufRead2, writeBuf);
  dm2.close();

  // Cleanup
  if (fs.existsSync(dbFile)) {
    fs.unlinkSync(dbFile);
  }
  console.log('✓ DiskManager tests passed');

  console.log('All tests passed successfully!');
}

runTests();

