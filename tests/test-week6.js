const assert = require('assert');
const fs = require('fs');
const path = require('path');

const WAL = require('../src/transaction/wal');
const TransactionManager = require('../src/transaction/transaction-manager');
const Catalog = require('../src/catalog');
const DiskManager = require('../src/storage/disk-manager');
const BufferPool = require('../src/storage/buffer-pool');
const { tokenize } = require('../src/sql/lexer');
const { Parser } = require('../src/sql/parser');
const {
  executeWithMVCC,
  beginMVCCTransaction,
  commitMVCCTransaction,
  rollbackMVCCTransaction,
} = require('../src/executor/executor');

const WAL_PATH = path.join(__dirname, '..', 'data', 'test-week6.wal');
const DB_PATH  = path.join(__dirname, '..', 'data', 'test-week6.db');

function cleanup() {
  if (fs.existsSync(WAL_PATH)) fs.unlinkSync(WAL_PATH);
  if (fs.existsSync(DB_PATH))  fs.unlinkSync(DB_PATH);
}

function parse(sql) {
  return new Parser(tokenize(sql)).parse();
}

const SCHEMA = [
  { name: 'id',   dataType: 'INT' },
  { name: 'name', dataType: 'VARCHAR', length: 100 },
  { name: 'age',  dataType: 'INT' },
];

/**
 * Creates a fresh set of components for each test.
 * Returns { wal, txnManager, catalog, disk, pool }.
 */
function freshEnv() {
  cleanup();
  const disk    = new DiskManager(DB_PATH);
  const pool    = new BufferPool(disk, 10);
  const wal     = new WAL(WAL_PATH);
  const catalog = new Catalog();
  const txnManager = new TransactionManager();

  catalog.createTable('users', SCHEMA);
  catalog.createIndex('users', 'age');

  return { wal, txnManager, catalog, disk, pool };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function testOwnUncommittedWriteIsVisibleToSelf() {
  const { wal, txnManager, catalog, disk, pool } = freshEnv();

  const txn1 = beginMVCCTransaction(wal, txnManager);
  executeWithMVCC(parse("INSERT INTO users VALUES (1, 'Alice', 25)"), catalog, pool, wal, txnManager, txn1);

  // SELECT without committing — read-your-own-writes
  const rows = executeWithMVCC(parse("SELECT * FROM users"), catalog, pool, wal, txnManager, txn1);

  assert.strictEqual(rows.length, 1, `Expected 1 row visible to self, got ${rows.length}`);
  assert.strictEqual(rows[0].name, 'Alice');

  pool.flushAll();
  disk.close();
  console.log('✓ testOwnUncommittedWriteIsVisibleToSelf passed');
}

function testDirtyReadIsPrevented() {
  const { wal, txnManager, catalog, disk, pool } = freshEnv();

  // txn1 inserts but does NOT commit
  const txn1 = beginMVCCTransaction(wal, txnManager);
  executeWithMVCC(parse("INSERT INTO users VALUES (1, 'Alice', 25)"), catalog, pool, wal, txnManager, txn1);

  // txn2 starts — should NOT see txn1's uncommitted row
  const txn2 = beginMVCCTransaction(wal, txnManager);
  const rows = executeWithMVCC(parse("SELECT * FROM users"), catalog, pool, wal, txnManager, txn2);

  assert.strictEqual(rows.length, 0, `Expected 0 rows (dirty read prevented), got ${rows.length}`);

  pool.flushAll();
  disk.close();
  console.log('✓ testDirtyReadIsPrevented passed');
}

function testCommittedWriteBecomesVisible() {
  const { wal, txnManager, catalog, disk, pool } = freshEnv();

  // txn1 inserts and commits
  const txn1 = beginMVCCTransaction(wal, txnManager);
  executeWithMVCC(parse("INSERT INTO users VALUES (1, 'Alice', 25)"), catalog, pool, wal, txnManager, txn1);
  commitMVCCTransaction(wal, txnManager, txn1);

  // txn2 starts after the commit — should see the row
  const txn2 = beginMVCCTransaction(wal, txnManager);
  const rows = executeWithMVCC(parse("SELECT * FROM users"), catalog, pool, wal, txnManager, txn2);

  assert.strictEqual(rows.length, 1, `Expected 1 row after commit, got ${rows.length}`);
  assert.strictEqual(rows[0].name, 'Alice');

  pool.flushAll();
  disk.close();
  console.log('✓ testCommittedWriteBecomesVisible passed');
}

function testRollbackHidesInsertPermanently() {
  const { wal, txnManager, catalog, disk, pool } = freshEnv();

  // txn1 inserts then rolls back
  const txn1 = beginMVCCTransaction(wal, txnManager);
  executeWithMVCC(parse("INSERT INTO users VALUES (1, 'Alice', 25)"), catalog, pool, wal, txnManager, txn1);
  rollbackMVCCTransaction(wal, txnManager, txn1);

  // txn2 starts after the abort — row should be permanently invisible
  const txn2 = beginMVCCTransaction(wal, txnManager);
  const rows = executeWithMVCC(parse("SELECT * FROM users"), catalog, pool, wal, txnManager, txn2);

  assert.strictEqual(rows.length, 0, `Expected 0 rows after rollback, got ${rows.length}`);

  pool.flushAll();
  disk.close();
  console.log('✓ testRollbackHidesInsertPermanently passed');
}

function testLogicalDeleteRespectsIsolation() {
  const { wal, txnManager, catalog, disk, pool } = freshEnv();

  // txn1 inserts and commits a row
  const txn1 = beginMVCCTransaction(wal, txnManager);
  executeWithMVCC(parse("INSERT INTO users VALUES (1, 'Alice', 25)"), catalog, pool, wal, txnManager, txn1);
  commitMVCCTransaction(wal, txnManager, txn1);

  // txn2 deletes the row but does NOT commit
  const txn2 = beginMVCCTransaction(wal, txnManager);
  executeWithMVCC(parse("DELETE FROM users WHERE name = 'Alice'"), catalog, pool, wal, txnManager, txn2);

  // txn3 starts concurrently — the uncommitted delete should NOT affect it
  const txn3 = beginMVCCTransaction(wal, txnManager);
  const rowsBefore = executeWithMVCC(parse("SELECT * FROM users"), catalog, pool, wal, txnManager, txn3);
  assert.strictEqual(rowsBefore.length, 1,
    `Expected 1 row (delete not committed yet), got ${rowsBefore.length}`);
  assert.strictEqual(rowsBefore[0].name, 'Alice');

  // Now commit the delete
  commitMVCCTransaction(wal, txnManager, txn2);

  // txn4 starts after the delete is committed — row should be gone
  const txn4 = beginMVCCTransaction(wal, txnManager);
  const rowsAfter = executeWithMVCC(parse("SELECT * FROM users"), catalog, pool, wal, txnManager, txn4);
  assert.strictEqual(rowsAfter.length, 0,
    `Expected 0 rows after committed delete, got ${rowsAfter.length}`);

  pool.flushAll();
  disk.close();
  console.log('✓ testLogicalDeleteRespectsIsolation passed');
}

// ---------------------------------------------------------------------------
// Run all
// ---------------------------------------------------------------------------
function runAllTests() {
  console.log('Running Week 6 tests...');
  cleanup();

  testOwnUncommittedWriteIsVisibleToSelf();
  testDirtyReadIsPrevented();
  testCommittedWriteBecomesVisible();
  testRollbackHidesInsertPermanently();
  testLogicalDeleteRespectsIsolation();

  cleanup();
  console.log('All Week 6 tests passed');
}

runAllTests();
