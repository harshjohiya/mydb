const assert = require('assert');
const fs = require('fs');
const path = require('path');

const Catalog = require('../src/catalog');
const DiskManager = require('../src/storage/disk-manager');
const BufferPool = require('../src/storage/buffer-pool');
const { tokenize } = require('../src/sql/lexer');
const { Parser } = require('../src/sql/parser');
const { execute } = require('../src/executor/executor');
const { chooseScanStrategy } = require('../src/sql/cost-estimator');
const { BPlusTree } = require('../src/index/btree');

const DB_PATH = path.join(__dirname, '..', 'data', 'test-week7.db');

function cleanup() {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
}

function parse(sql) {
  return new Parser(tokenize(sql)).parse();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function testIndexChosenForHighSelectivity() {
  cleanup();
  const disk = new DiskManager(DB_PATH);
  const pool = new BufferPool(disk, 10);
  const catalog = new Catalog();

  catalog.createTable('users', [
    { name: 'id', dataType: 'INT' },
    { name: 'age', dataType: 'INT' },
    { name: 'filler', dataType: 'VARCHAR', length: 800 }
  ]);
  catalog.createIndex('users', 'age');

  const padding = "'" + "x".repeat(800) + "'";

  // Insert 20 rows, 1 row has age=99
  // With ~1000 bytes per row, 20 rows take ~5 pages (seqCost = 5)
  // indexCost = 3 + (20 / 20) = 4. 4 < 5, so index is chosen.
  for (let i = 1; i <= 19; i++) {
    execute(parse(`INSERT INTO users VALUES (${i}, ${i}, ${padding})`), catalog, pool);
  }
  execute(parse(`INSERT INTO users VALUES (20, 99, ${padding})`), catalog, pool);

  const ast = parse("SELECT * FROM users WHERE age = 99");
  const decision = chooseScanStrategy(catalog, 'users', ast.where);
  
  assert.strictEqual(decision.strategy, 'index', 'Should choose index for highly selective query');

  pool.flushAll();
  disk.close();
  console.log('✓ testIndexChosenForHighSelectivity passed');
}

function testSeqScanChosenForLowSelectivity() {
  cleanup();
  const disk = new DiskManager(DB_PATH);
  const pool = new BufferPool(disk, 10);
  const catalog = new Catalog();

  catalog.createTable('users', [
    { name: 'id', dataType: 'INT' },
    { name: 'age', dataType: 'INT' },
    { name: 'filler', dataType: 'VARCHAR', length: 800 }
  ]);
  catalog.createIndex('users', 'age');

  const padding = "'" + "x".repeat(800) + "'";

  // Insert 20 rows, 15 have age=30
  // seqCost = 5 pages.
  // distinctKeys = 6. estimatedMatches = 20 / 6 = 3.33. indexCost = 3 + 3.33 = 6.33.
  // 6.33 < 5 is false, so seq scan is chosen.
  for (let i = 1; i <= 15; i++) {
    execute(parse(`INSERT INTO users VALUES (${i}, 30, ${padding})`), catalog, pool);
  }
  for (let i = 16; i <= 20; i++) {
    execute(parse(`INSERT INTO users VALUES (${i}, ${i}, ${padding})`), catalog, pool);
  }

  const ast = parse("SELECT * FROM users WHERE age = 30");
  const decision = chooseScanStrategy(catalog, 'users', ast.where);
  
  // Seq scan is cheaper because index traversal overhead (3) + est rows (20 / distinct=6 => ~3) = 6. 
  // Wait, wait... distinct is 6. 20 / 6 = 3.33. Index cost = 3 + 3.33 = 6.33. 
  // How many pages will 20 rows take? A row of 2 ints + JSON overhead is maybe 30 bytes.
  // 4096 / 30 = ~136 rows per page. So 20 rows will fit in exactly 1 page.
  // seqCost = 1.
  // indexCost = 6.33.
  // seq scan will be chosen!
  assert.strictEqual(decision.strategy, 'seq', 'Should choose seq scan for low selectivity query (or tiny tables)');

  pool.flushAll();
  disk.close();
  console.log('✓ testSeqScanChosenForLowSelectivity passed');
}

function testSeqScanChosenWhenNoIndexExists() {
  cleanup();
  const disk = new DiskManager(DB_PATH);
  const pool = new BufferPool(disk, 10);
  const catalog = new Catalog();

  catalog.createTable('noindex', [
    { name: 'id', dataType: 'INT' },
    { name: 'age', dataType: 'INT' }
  ]);

  execute(parse("INSERT INTO noindex VALUES (1, 99)"), catalog, pool);

  const ast = parse("SELECT * FROM noindex WHERE age = 99");
  const decision = chooseScanStrategy(catalog, 'noindex', ast.where);
  
  assert.strictEqual(decision.strategy, 'seq', 'Should choose seq scan when no index exists');

  pool.flushAll();
  disk.close();
  console.log('✓ testSeqScanChosenWhenNoIndexExists passed');
}

function testRowCountTracking() {
  cleanup();
  const disk = new DiskManager(DB_PATH);
  const pool = new BufferPool(disk, 10);
  const catalog = new Catalog();

  catalog.createTable('t1', [
    { name: 'id', dataType: 'INT' }
  ]);

  assert.strictEqual(catalog.getRowCount('t1'), 0, 'Initial row count should be 0');

  execute(parse("INSERT INTO t1 VALUES (1)"), catalog, pool);
  execute(parse("INSERT INTO t1 VALUES (2)"), catalog, pool);
  execute(parse("INSERT INTO t1 VALUES (3)"), catalog, pool);

  assert.strictEqual(catalog.getRowCount('t1'), 3, 'Row count should be 3 after inserts');

  execute(parse("DELETE FROM t1 WHERE id = 2"), catalog, pool);

  assert.strictEqual(catalog.getRowCount('t1'), 2, 'Row count should be 2 after delete');

  pool.flushAll();
  disk.close();
  console.log('✓ testRowCountTracking passed');
}

function testCountKeysMatchesInsertedRows() {
  const tree = new BPlusTree(4);
  
  for (let i = 1; i <= 10; i++) {
    tree.insert(i, { pageId: 1, slotIndex: i });
  }

  assert.strictEqual(tree.countKeys(), 10, 'countKeys should return 10 after 10 unique inserts');

  tree.delete(2);
  tree.delete(4);
  tree.delete(6);

  assert.strictEqual(tree.countKeys(), 7, 'countKeys should return 7 after 3 deletes');

  console.log('✓ testCountKeysMatchesInsertedRows passed');
}

// ---------------------------------------------------------------------------
// Run all
// ---------------------------------------------------------------------------
function runAllTests() {
  console.log('Running Week 7 tests...');
  cleanup(); // ensure clean slate before the first test

  testIndexChosenForHighSelectivity();
  testSeqScanChosenForLowSelectivity();
  testSeqScanChosenWhenNoIndexExists();
  testRowCountTracking();
  testCountKeysMatchesInsertedRows();

  cleanup();
  console.log('All Week 7 tests passed');
}

runAllTests();
