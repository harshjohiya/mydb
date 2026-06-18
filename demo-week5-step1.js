/**
 * demo-week5-step1.js — "The database before a crash"
 *
 * This script sets up the engine, inserts data in two transactions,
 * commits the first, then exits WITHOUT committing the second or flushing
 * the buffer pool — simulating a hard crash / power loss.
 *
 * Run next: npm run demo:week5:step2
 */

const path = require('path');
const fs   = require('fs');

const WAL         = require('./src/transaction/wal');
const Catalog     = require('./src/catalog');
const DiskManager = require('./src/storage/disk-manager');
const BufferPool  = require('./src/storage/buffer-pool');
const { tokenize }         = require('./src/sql/lexer');
const { Parser }           = require('./src/sql/parser');
const { executeWithWAL, beginTransaction, commitTransaction } = require('./src/executor/executor');

const WAL_PATH = path.join(__dirname, 'data', 'mydb-week5.wal');
const DB_PATH  = path.join(__dirname, 'data', 'mydb-week5.db');

// Clean up any leftover files from a previous demo run
if (fs.existsSync(WAL_PATH)) fs.unlinkSync(WAL_PATH);
if (fs.existsSync(DB_PATH))  fs.unlinkSync(DB_PATH);

function parse(sql) { return new Parser(tokenize(sql)).parse(); }

console.log('=== Week 5 Demo — Step 1: Pre-crash ===\n');

// ── Setup ────────────────────────────────────────────────────────────────────
console.log('[setup] Opening DiskManager and BufferPool on data/mydb-week5.db');
const disk    = new DiskManager(DB_PATH);
const pool    = new BufferPool(disk, 10);
const catalog = new Catalog();
const wal     = new WAL(WAL_PATH);
console.log('[setup] WAL initialised at data/mydb-week5.wal\n');

// ── Create schema ────────────────────────────────────────────────────────────
console.log('[schema] CREATE TABLE users (id INT, name VARCHAR(100), age INT)');
catalog.createTable('users', [
  { name: 'id',   dataType: 'INT' },
  { name: 'name', dataType: 'VARCHAR', length: 100 },
  { name: 'age',  dataType: 'INT' },
]);
console.log('[schema] Creating B+ Tree index on users.age');
catalog.createIndex('users', 'age');
console.log();

// ── Transaction 1 — committed ────────────────────────────────────────────────
console.log('[txn1] beginTransaction');
beginTransaction(wal, 'txn1');

const inserts1 = [
  "INSERT INTO users VALUES (1, 'Alice',   25)",
  "INSERT INTO users VALUES (2, 'Bob',     30)",
  "INSERT INTO users VALUES (3, 'Charlie', 22)",
];
for (const sql of inserts1) {
  console.log(`[txn1] ${sql}`);
  executeWithWAL(parse(sql), catalog, pool, wal, 'txn1');
}

console.log('[txn1] commitTransaction  ← COMMIT written to WAL');
commitTransaction(wal, 'txn1');
console.log();

// ── Transaction 2 — NOT committed (crash before commit) ──────────────────────
console.log('[txn2] beginTransaction');
beginTransaction(wal, 'txn2');

const sql2 = "INSERT INTO users VALUES (4, 'Diana', 28)";
console.log(`[txn2] ${sql2}`);
executeWithWAL(parse(sql2), catalog, pool, wal, 'txn2');

console.log();
console.log('=== Simulating a crash now: process exits WITHOUT flushing the');
console.log('    buffer pool or committing the open transaction ===');
console.log();
console.log('WAL on disk :', WAL_PATH);
console.log('DB  on disk :', DB_PATH, '(dirty pages never written — data "lost")');
console.log();
console.log('Now run: npm run demo:week5:step2');

// Intentionally do NOT call pool.flushAll() or disk.close().
// The process ends here; dirty buffer pages are discarded.
