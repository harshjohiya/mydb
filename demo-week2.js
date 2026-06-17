const path = require('path');
const DiskManager = require('./src/storage/disk-manager');
const BufferPool = require('./src/storage/buffer-pool');
const { BPlusTree } = require('./src/index/btree');

// 1. Set up a DiskManager + BufferPool pointing at data/mydb.db
const dbFilePath = path.join(__dirname, 'data', 'mydb.db');
const diskManager = new DiskManager(dbFilePath);
const pool = new BufferPool(diskManager, 4);

// 2. Create a BPlusTree (order 4) to index users by their 'age' field
const tree = new BPlusTree(4);

// 3. Insert 5 fake users
const users = [
  { id: 1, name: 'Alice', age: 25 },
  { id: 2, name: 'Bob', age: 30 },
  { id: 3, name: 'Charlie', age: 22 },
  { id: 4, name: 'Diana', age: 28 },
  { id: 5, name: 'Eve', age: 35 }
];

console.log('--- Step 1: Inserting Users ---');
// Let's allocate a page for data
const page = pool.newPage();
const pageId = page.pageId;

users.forEach(user => {
  const data = JSON.stringify(user);
  const slotIndex = page.writeSlot(data);
  
  // Insert (age, { pageId, slotIndex }) into the B+ Tree
  tree.insert(user.age, { pageId, slotIndex });
  console.log(`Inserted user ${user.name} (age=${user.age}) into storage. Indexing age -> { pageId: ${pageId}, slotIndex: ${slotIndex} }`);
});

// Unpin the page so it can be evicted or flushed later
pool.unpinPage(pageId);

// 4. Point lookup
console.log('\n--- Step 2: Point Lookup (age=28) ---');
const searchAge = 28;
console.log(`Looking up index for age=${searchAge}...`);
const pointer = tree.search(searchAge);

if (pointer) {
  console.log(`Found pointer { pageId: ${pointer.pageId}, slotIndex: ${pointer.slotIndex} }... fetching from storage layer...`);
  
  const lookupPage = pool.getPage(pointer.pageId);
  const recordData = lookupPage.readSlot(pointer.slotIndex).toString('utf-8');
  const record = JSON.parse(recordData);
  
  console.log('Result:', record);
  pool.unpinPage(pointer.pageId);
} else {
  console.log('Not found.');
}

// 5. Range query
console.log('\n--- Step 3: Range Query (ages 22 to 30) ---');
console.log('Looking up index for ages 22 to 30...');
const rangeResults = tree.rangeSearch(22, 30);
console.log(`Found ${rangeResults.length} index entries. Fetching records from storage...`);

rangeResults.forEach(res => {
  const rp = res.recordId;
  const lookupPage = pool.getPage(rp.pageId);
  const recordData = lookupPage.readSlot(rp.slotIndex).toString('utf-8');
  const record = JSON.parse(recordData);
  console.log(`Age ${res.key} ->`, record);
  pool.unpinPage(rp.pageId);
});

// 6. flushAll() on the buffer pool, then close the disk manager
console.log('\n--- Step 4: Cleanup ---');
console.log('Flushing buffer pool and closing disk manager...');
pool.flushAll();
diskManager.close();
console.log('Done.');
