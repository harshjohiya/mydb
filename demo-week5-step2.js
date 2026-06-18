/**
 * demo-week5-step2.js — "Restarting after the crash"
 *
 * Opens the WAL file left on disk from step 1, rebuilds the schema in a
 * fresh catalog + buffer pool, and calls recover() to replay only the
 * committed transactions.
 *
 * Run after: npm run demo:week5:step1
 */

const path = require('path');
const fs   = require('fs');

const WAL         = require('./src/transaction/wal');
const { recover } = require('./src/transaction/recovery');
const Catalog     = require('./src/catalog');
const DiskManager = require('./src/storage/disk-manager');
const BufferPool  = require('./src/storage/buffer-pool');
const { tokenize }  = require('./src/sql/lexer');
const { Parser }    = require('./src/sql/parser');
const { execute }   = require('./src/executor/executor');

const WAL_PATH = path.join(__dirname, 'data', 'mydb-week5.wal');
const DB_PATH  = path.join(__dirname, 'data', 'mydb-week5.db');

if (!fs.existsSync(WAL_PATH)) {
  console.error('ERROR: WAL file not found. Run step 1 first:\n  npm run demo:week5:step1');
  process.exit(1);
}

function parse(sql) { return new Parser(tokenize(sql)).parse(); }

console.log('=== Week 5 Demo — Step 2: Post-crash Recovery ===\n');

// ── Fresh process — all prior in-memory state is gone ────────────────────────
console.log('[startup] Opening a NEW DiskManager + BufferPool (blank in-memory state)');
const disk    = new DiskManager(DB_PATH);
const pool    = new BufferPool(disk, 10);
const catalog = new Catalog();
console.log('[startup] Opening the SAME WAL file from disk:', WAL_PATH, '\n');
const wal     = new WAL(WAL_PATH);

// Show what survived on disk
const allEntries = wal.readAll();
console.log(`[wal] Found ${allEntries.length} log entries on disk:`);
for (const e of allEntries) {
  const detail = e.data ? '  data=' + JSON.stringify(e.data) : '';
  console.log(`  LSN ${String(e.lsn).padStart(2)} | txn=${e.txnId} | type=${e.type}${detail}`);
}
console.log();

// ── Rebuild schema ────────────────────────────────────────────────────────────
console.log('[schema] NOTE: schema is not persisted yet — rebuilding manually.');
console.log('[schema] Recreating users table + age index on fresh catalog.');
catalog.createTable('users', [
  { name: 'id',   dataType: 'INT' },
  { name: 'name', dataType: 'VARCHAR', length: 100 },
  { name: 'age',  dataType: 'INT' },
]);
catalog.createIndex('users', 'age');
console.log();

// ── Run recovery ──────────────────────────────────────────────────────────────
console.log('[recovery] Starting REDO pass...');
const result = recover(wal, catalog, pool);
console.log(`[recovery] Done — insertsReplayed=${result.insertsReplayed}, deletesSkipped=${result.deletesSkipped}`);
console.log();

// ── Verify recovered state ────────────────────────────────────────────────────
console.log('[verify] SELECT * FROM users:');
const rows = execute(parse('SELECT * FROM users'), catalog, pool);
if (rows.length === 0) {
  console.log('  (no rows)');
} else {
  rows.forEach(r => console.log(' ', JSON.stringify(r)));
}
console.log();

// ── Conclusion ────────────────────────────────────────────────────────────────
const names = rows.map(r => r.name);
const hasDiana    = names.includes('Diana');
const hasCommitted = names.includes('Alice') && names.includes('Bob') && names.includes('Charlie');

console.log('─'.repeat(55));
if (hasCommitted && !hasDiana) {
  console.log(`✓ Recovery successful! ${rows.length} row(s) recovered.`);
  console.log('  Alice, Bob, Charlie (txn1 — COMMITTED) ✓ present');
  console.log('  Diana               (txn2 — NO COMMIT) ✓ absent');
} else {
  if (!hasCommitted) console.error('✗ Some committed rows are missing after recovery!');
  if (hasDiana)      console.error('✗ Uncommitted row (Diana) incorrectly present after recovery!');
}
console.log('─'.repeat(55));

pool.flushAll();
disk.close();
