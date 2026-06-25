const assert = require('assert');
const fs = require('fs');
const path = require('path');

const WAL = require('../src/transaction/wal');
const { recover } = require('../src/transaction/recovery');
const Catalog = require('../src/catalog');
const DiskManager = require('../src/storage/disk-manager');
const BufferPool = require('../src/storage/buffer-pool');
const { tokenize } = require('../src/sql/lexer');
const { Parser } = require('../src/sql/parser');
const {
  execute,
  executeWithWAL,
  beginTransaction,
  commitTransaction,
} = require('../src/executor/executor');

const WAL_PATH = path.join(__dirname, '..', 'data', 'test-week5.wal');
const DB_PATH  = path.join(__dirname, '..', 'data', 'test-week5.db');

function cleanup() {
  if (fs.existsSync(WAL_PATH)) fs.unlinkSync(WAL_PATH);
  if (fs.existsSync(DB_PATH))  fs.unlinkSync(DB_PATH);
}

function parse(sql) {
  return new Parser(tokenize(sql)).parse();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function testWALLogAndReadAll() {
  cleanup();
  const wal = new WAL(WAL_PATH);

  wal.logBegin('tx1');
  wal.logInsert('tx1', 'users', { id: 1, name: 'Alice', age: 25 });
  wal.logCommit('tx1');

  const entries = wal.readAll();
  assert.strictEqual(entries.length, 3);
  assert.strictEqual(entries[0].type, 'BEGIN');
  assert.strictEqual(entries[0].txnId, 'tx1');
  assert.strictEqual(entries[1].type, 'INSERT');
  assert.strictEqual(entries[1].txnId, 'tx1');
  assert.strictEqual(entries[2].type, 'COMMIT');
  assert.strictEqual(entries[2].txnId, 'tx1');

  console.log('✓ testWALLogAndReadAll passed');
}

function testWALExcludesUncommittedFromRedoLog() {
  cleanup();
  const wal = new WAL(WAL_PATH);

  // tx1: committed
  wal.logBegin('tx1');
  wal.logInsert('tx1', 'users', { id: 1, name: 'Alice', age: 25 });
  wal.logCommit('tx1');

  // tx2: no commit — simulates crash mid-transaction
  wal.logBegin('tx2');
  wal.logInsert('tx2', 'users', { id: 2, name: 'Bob', age: 30 });

  const redoLog = wal.getRedoLog();
  assert.strictEqual(redoLog.length, 1);
  assert.strictEqual(redoLog[0].txnId, 'tx1');
  assert.ok(!redoLog.some(e => e.txnId === 'tx2'));

  console.log('✓ testWALExcludesUncommittedFromRedoLog passed');
}

function testWALExcludesAbortedFromRedoLog() {
  cleanup();
  const wal = new WAL(WAL_PATH);

  // tx3: explicitly aborted
  wal.logBegin('tx3');
  wal.logInsert('tx3', 'users', { id: 3, name: 'Charlie', age: 22 });
  wal.logAbort('tx3');

  const redoLog = wal.getRedoLog();
  assert.strictEqual(redoLog.length, 0, 'Aborted txn insert must not appear in redo log');

  console.log('✓ testWALExcludesAbortedFromRedoLog passed');
}

function testCrashRecoveryReplaysCommittedInserts() {
  cleanup();

  const SCHEMA = [
    { name: 'id',   dataType: 'INT' },
    { name: 'name', dataType: 'VARCHAR', length: 100 },
    { name: 'age',  dataType: 'INT' },
  ];

  // ── Phase 1: Pre-crash ─────────────────────────────────────────────────────
  const wal      = new WAL(WAL_PATH);
  const disk     = new DiskManager(DB_PATH);
  const pool     = new BufferPool(disk, 10);
  const catalog  = new Catalog();

  catalog.createTable('users', SCHEMA);
  catalog.createIndex('users', 'age');

  // Committed transaction — 2 inserts
  beginTransaction(wal, 'txn1');
  executeWithWAL(parse("INSERT INTO users VALUES (1, 'Alice', 25)"), catalog, pool, wal, 'txn1');
  executeWithWAL(parse("INSERT INTO users VALUES (2, 'Bob', 30)"),   catalog, pool, wal, 'txn1');
  commitTransaction(wal, 'txn1');

  // Uncommitted transaction — 1 insert, no commit (simulated crash)
  beginTransaction(wal, 'txn2');
  executeWithWAL(parse("INSERT INTO users VALUES (3, 'Charlie', 99)"), catalog, pool, wal, 'txn2');
  // ← NO commitTransaction — simulating an unclean shutdown

  // Do NOT flush the buffer pool — dirty pages are "lost" on crash.
  // We simply abandon the old objects (garbage collected).

  // ── Phase 2: Post-crash (new process) ──────────────────────────────────────
  const wal2     = new WAL(WAL_PATH);         // same .wal file on disk
  const disk2    = new DiskManager(DB_PATH);  // same .db file (pages lost)
  const pool2    = new BufferPool(disk2, 10);
  const catalog2 = new Catalog();

  // Schema must be rebuilt (not persisted — documented limitation)
  catalog2.createTable('users', SCHEMA);
  catalog2.createIndex('users', 'age');

  const result = recover(wal2, catalog2, pool2);

  // 1. Exactly 2 committed inserts should be replayed
  assert.strictEqual(result.insertsReplayed, 2,
    `Expected 2 inserts replayed, got ${result.insertsReplayed}`);

  // 2. SELECT * FROM users must return exactly those 2 rows
  const rows = execute(parse("SELECT * FROM users"), catalog2, pool2);
  assert.strictEqual(rows.length, 2,
    `Expected 2 rows after recovery, got ${rows.length}`);

  // 3. The uncommitted row (Charlie, age 99) must NOT appear
  const hasCharlie = rows.some(r => r.name === 'Charlie' || r.age === 99);
  assert.ok(!hasCharlie, 'Uncommitted row (Charlie) must not be present after recovery');

  // 4. The committed rows must be present
  const names = rows.map(r => r.name).sort();
  assert.deepStrictEqual(names, ['Alice', 'Bob']);

  pool2.flushAll();
  disk2.close();

  console.log('✓ testCrashRecoveryReplaysCommittedInserts passed');
}

// ---------------------------------------------------------------------------
// Run all
// ---------------------------------------------------------------------------
function runAllTests() {
  console.log('Running Recovery tests...');
  cleanup(); // ensure clean slate before the first test

  testWALLogAndReadAll();
  testWALExcludesUncommittedFromRedoLog();
  testWALExcludesAbortedFromRedoLog();
  testCrashRecoveryReplaysCommittedInserts();

  cleanup();
  console.log('All Recovery tests passed');
}

runAllTests();
