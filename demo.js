const path = require('path');
const fs = require('fs');
const DiskManager = require('./src/storage/disk-manager');
const BufferPool = require('./src/storage/buffer-pool');

async function runDemo() {
  console.log('--- Database Storage Layer Demo ---');

  const dbFilePath = path.join(__dirname, 'data', 'mydb.db');

  // Ensure fresh start for demo
  if (fs.existsSync(dbFilePath)) {
    fs.unlinkSync(dbFilePath);
  }

  console.log('1. Initializing DiskManager & BufferPool (poolSize = 4)...');
  let diskManager = new DiskManager(dbFilePath);
  let bufferPool = new BufferPool(diskManager, 4);

  console.log('2. Creating a new page...');
  const page = bufferPool.newPage();
  const pageId = page.pageId;
  console.log(`   Page created with ID: ${pageId}`);

  console.log('3. Writing records to the page...');
  const rec1 = "Hello, DB!";
  const rec2 = JSON.stringify({ id: 1, name: 'Rahul', age: 22 });

  const slot0 = page.writeSlot(rec1);
  const slot1 = page.writeSlot(rec2);

  console.log(`   Written record 1 to slot ${slot0}: "${rec1}"`);
  console.log(`   Written record 2 to slot ${slot1}: "${rec2}"`);

  console.log('4. Flushing page to disk and closing DiskManager (simulating shutdown)...');
  bufferPool.flushPage(pageId);
  diskManager.close();

  console.log('5. Restarting database engine...');
  console.log('   Opening a BRAND NEW DiskManager & BufferPool...');
  diskManager = new DiskManager(dbFilePath);
  bufferPool = new BufferPool(diskManager, 4);

  console.log(`6. Reading page ${pageId} back from disk...`);
  const loadedPage = bufferPool.getPage(pageId);

  const read1 = loadedPage.readSlot(slot0);
  const read2 = loadedPage.readSlot(slot1);

  console.log('7. Verifying read records:');
  console.log(`   Slot ${slot0}: "${read1.toString()}"`);
  console.log(`   Slot ${slot1}: "${read2.toString()}"`);

  // Clean up
  diskManager.close();
  console.log('Demo completed successfully!');
}

runDemo().catch(console.error);
