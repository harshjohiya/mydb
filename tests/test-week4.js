const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Catalog = require('../src/catalog');
const DiskManager = require('../src/storage/disk-manager');
const BufferPool = require('../src/storage/buffer-pool');
const { tokenize } = require('../src/sql/lexer');
const { Parser } = require('../src/sql/parser');
const { execute } = require('../src/executor/executor');

const DB_PATH = path.join(__dirname, '..', 'data', 'test-week4.db');

// --- Helper Functions ---
function runSql(sql, catalog, bufferPool) {
  const ast = new Parser(tokenize(sql)).parse();
  return execute(ast, catalog, bufferPool);
}

function cleanupDb() {
  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function testCreateTable() {
  cleanupDb();
  const diskManager = new DiskManager(DB_PATH);
  const bufferPool = new BufferPool(diskManager, 10);
  const catalog = new Catalog();

  runSql("CREATE TABLE users (id INT, name VARCHAR(100), age INT)", catalog, bufferPool);
  assert.doesNotThrow(() => catalog.getTable("users"));

  bufferPool.flushAll();
  diskManager.close();
  console.log('✓ testCreateTable passed');
}

function testInsertAndSeqScanSelect() {
  cleanupDb();
  const diskManager = new DiskManager(DB_PATH);
  const bufferPool = new BufferPool(diskManager, 10);
  const catalog = new Catalog();

  runSql("CREATE TABLE users (id INT, name VARCHAR(100), age INT)", catalog, bufferPool);
  runSql("INSERT INTO users VALUES (1, 'Alice', 25)", catalog, bufferPool);
  runSql("INSERT INTO users VALUES (2, 'Bob', 30)", catalog, bufferPool);
  runSql("INSERT INTO users VALUES (3, 'Charlie', 22)", catalog, bufferPool);

  const results = runSql("SELECT * FROM users", catalog, bufferPool);
  assert.strictEqual(results.length, 3);
  assert.deepStrictEqual(results[0], { id: 1, name: 'Alice', age: 25 });
  assert.deepStrictEqual(results[1], { id: 2, name: 'Bob', age: 30 });
  assert.deepStrictEqual(results[2], { id: 3, name: 'Charlie', age: 22 });

  bufferPool.flushAll();
  diskManager.close();
  console.log('✓ testInsertAndSeqScanSelect passed');
}

function testSelectWithWhereNoIndex() {
  cleanupDb();
  const diskManager = new DiskManager(DB_PATH);
  const bufferPool = new BufferPool(diskManager, 10);
  const catalog = new Catalog();

  runSql("CREATE TABLE users (id INT, name VARCHAR(100), age INT)", catalog, bufferPool);
  runSql("INSERT INTO users VALUES (1, 'Alice', 25)", catalog, bufferPool);
  runSql("INSERT INTO users VALUES (2, 'Bob', 30)", catalog, bufferPool);
  runSql("INSERT INTO users VALUES (3, 'Charlie', 22)", catalog, bufferPool);
  runSql("INSERT INTO users VALUES (4, 'Diana', 28)", catalog, bufferPool);

  const results = runSql("SELECT name FROM users WHERE age > 25", catalog, bufferPool);
  assert.strictEqual(results.length, 2);
  assert.deepStrictEqual(results[0], { name: 'Bob' });
  assert.deepStrictEqual(results[1], { name: 'Diana' });

  bufferPool.flushAll();
  diskManager.close();
  console.log('✓ testSelectWithWhereNoIndex passed');
}

function testIndexScanGivesSameResultsAsSeqScan() {
  cleanupDb();
  const diskManager = new DiskManager(DB_PATH);
  const bufferPool = new BufferPool(diskManager, 10);
  const catalog = new Catalog();

  runSql("CREATE TABLE users (id INT, name VARCHAR(100), age INT)", catalog, bufferPool);
  catalog.createIndex("users", "age");

  runSql("INSERT INTO users VALUES (1, 'Alice', 25)", catalog, bufferPool);
  runSql("INSERT INTO users VALUES (2, 'Bob', 30)", catalog, bufferPool);
  runSql("INSERT INTO users VALUES (3, 'Charlie', 22)", catalog, bufferPool);
  runSql("INSERT INTO users VALUES (4, 'Diana', 28)", catalog, bufferPool);

  const results = runSql("SELECT name FROM users WHERE age > 25", catalog, bufferPool);
  
  // Note: B+ Tree range scan returns results ordered by key (age), so Bob (30) and Diana (28) 
  // will come out as Diana (28) then Bob (30). The seq scan returned them in insertion order.
  // The test ensures the same set of rows are returned.
  assert.strictEqual(results.length, 2);
  
  const names = results.map(r => r.name).sort();
  assert.deepStrictEqual(names, ['Bob', 'Diana']);

  bufferPool.flushAll();
  diskManager.close();
  console.log('✓ testIndexScanGivesSameResultsAsSeqScan passed');
}

function testDeleteRemovesRowAndIndexEntry() {
  cleanupDb();
  const diskManager = new DiskManager(DB_PATH);
  const bufferPool = new BufferPool(diskManager, 10);
  const catalog = new Catalog();

  runSql("CREATE TABLE users (id INT, name VARCHAR(100), age INT)", catalog, bufferPool);
  const index = catalog.createIndex("users", "age");

  runSql("INSERT INTO users VALUES (1, 'Alice', 25)", catalog, bufferPool);
  runSql("INSERT INTO users VALUES (2, 'Old Bob', 65)", catalog, bufferPool);
  runSql("INSERT INTO users VALUES (3, 'Charlie', 22)", catalog, bufferPool);
  runSql("INSERT INTO users VALUES (4, 'Old Diana', 70)", catalog, bufferPool);

  const deleteRes = runSql("DELETE FROM users WHERE age > 60", catalog, bufferPool);
  assert.strictEqual(deleteRes.message, '2 row(s) deleted.');

  const results = runSql("SELECT * FROM users WHERE age > 60", catalog, bufferPool);
  assert.strictEqual(results.length, 0);

  // Directly check the index to make sure they are gone
  assert.strictEqual(index.search(65), null);
  assert.strictEqual(index.search(70), null);
  // Unaffected rows must still be in the index
  assert.notStrictEqual(index.search(25), null);

  bufferPool.flushAll();
  diskManager.close();
  console.log('✓ testDeleteRemovesRowAndIndexEntry passed');
}

// ---------------------------------------------------------------------------
// Run all
// ---------------------------------------------------------------------------
function runAllTests() {
  console.log('Running Week 4 tests...');
  cleanupDb(); // Initial cleanup
  
  testCreateTable();
  testInsertAndSeqScanSelect();
  testSelectWithWhereNoIndex();
  testIndexScanGivesSameResultsAsSeqScan();
  testDeleteRemovesRowAndIndexEntry();
  
  cleanupDb(); // Final cleanup
  console.log('All Week 4 tests passed');
}

runAllTests();
