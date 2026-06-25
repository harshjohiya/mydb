const path = require('path');
const fs = require('fs');

const WAL = require('./src/transaction/wal');
const TransactionManager = require('./src/transaction/transaction-manager');
const Catalog = require('./src/catalog');
const DiskManager = require('./src/storage/disk-manager');
const BufferPool = require('./src/storage/buffer-pool');
const { tokenize } = require('./src/sql/lexer');
const { Parser } = require('./src/sql/parser');
const {
  executeWithMVCC,
  beginMVCCTransaction,
  commitMVCCTransaction,
  rollbackMVCCTransaction,
} = require('./src/executor/executor');

const DB_PATH = path.join(__dirname, 'data', 'mydb-week6.db');
const WAL_PATH = path.join(__dirname, 'data', 'mydb-week6.wal');

// Cleanup previous runs
if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
if (fs.existsSync(WAL_PATH)) fs.unlinkSync(WAL_PATH);

function parse(sql) {
  return new Parser(tokenize(sql)).parse();
}

console.log('=== Week 6 Demo: MVCC Isolation ===\n');

// 1. Setup
console.log('1. Setting up Database components...');
const disk = new DiskManager(DB_PATH);
const pool = new BufferPool(disk, 10);
const wal = new WAL(WAL_PATH);
const catalog = new Catalog();
const txnManager = new TransactionManager();

catalog.createTable('users', [
  { name: 'id', dataType: 'INT' },
  { name: 'name', dataType: 'VARCHAR', length: 100 },
  { name: 'age', dataType: 'INT' },
]);
catalog.createIndex('users', 'age');
console.log('   Catalog + "users" table + age index created.\n');

// 2. Transaction A starts
const txnA = beginMVCCTransaction(wal, txnManager);
console.log(`2. Transaction A started (txnId: ${txnA})`);

// 3. Insert 2 users
executeWithMVCC(parse("INSERT INTO users VALUES (1, 'Alice', 25)"), catalog, pool, wal, txnManager, txnA);
executeWithMVCC(parse("INSERT INTO users VALUES (2, 'Bob', 30)"), catalog, pool, wal, txnManager, txnA);
console.log(`3. Inserted Alice and Bob under Transaction A. (NOT COMMITTED)`);

// 4. Transaction B starts
const txnB = beginMVCCTransaction(wal, txnManager);
console.log(`\n4. Transaction B started (txnId: ${txnB}) — txnA has NOT committed yet`);

// 5. SELECT under txnB
console.log(`5. Running SELECT * under Transaction B...`);
const rowsB1 = executeWithMVCC(parse("SELECT * FROM users"), catalog, pool, wal, txnManager, txnB);
console.log(`   Results:`, rowsB1);
console.log(`   Notice: Transaction B sees ${rowsB1.length} rows — txnA's uncommitted insert is correctly invisible (no dirty read).`);

// 6. Commit txnA
console.log(`\n6. Committing Transaction A...`);
commitMVCCTransaction(wal, txnManager, txnA);
console.log(`   Transaction A committed.`);

// 7. Transaction C starts
const txnC = beginMVCCTransaction(wal, txnManager);
console.log(`\n7. Transaction C started AFTER A's commit (txnId: ${txnC})`);

// 8. SELECT under txnC
console.log(`8. Running SELECT * under Transaction C...`);
const rowsC = executeWithMVCC(parse("SELECT * FROM users"), catalog, pool, wal, txnManager, txnC);
console.log(`   Results:`, rowsC);
console.log(`   Notice: Transaction C sees txnA's rows because the commit happened before C began.`);

// 9. SELECT under txnB again
console.log(`\n9. Running SELECT * under Transaction B (which is STILL open)...`);
const rowsB2 = executeWithMVCC(parse("SELECT * FROM users"), catalog, pool, wal, txnManager, txnB);
console.log(`   Results:`, rowsB2);
console.log(`   Notice: Transaction B NOW sees the rows too! This is "read committed" isolation.`);
console.log(`   (A true "snapshot isolation" database like PostgreSQL would NOT let B see these rows `);
console.log(`   because B started before A committed. That's a great future exercise.)`);

// 10. Transaction D starts and deletes
const txnD = beginMVCCTransaction(wal, txnManager);
console.log(`\n10. Transaction D started (txnId: ${txnD}). Deleting Alice (without committing)...`);
executeWithMVCC(parse("DELETE FROM users WHERE name = 'Alice'"), catalog, pool, wal, txnManager, txnD);

console.log(`    Running SELECT * under Transaction C again...`);
const rowsC2 = executeWithMVCC(parse("SELECT * FROM users"), catalog, pool, wal, txnManager, txnC);
console.log(`    Results:`, rowsC2);
console.log(`    Notice: Alice is still visible to Transaction C because D's delete is uncommitted.`);

// 11. Commit txnD
console.log(`\n11. Committing Transaction D...`);
commitMVCCTransaction(wal, txnManager, txnD);
console.log(`    Transaction D committed the delete.`);

// 12. Transaction E starts
const txnE = beginMVCCTransaction(wal, txnManager);
console.log(`\n12. Transaction E started (txnId: ${txnE}). Running final SELECT *...`);
const rowsE = executeWithMVCC(parse("SELECT * FROM users"), catalog, pool, wal, txnManager, txnE);
console.log(`    Results:`, rowsE);
console.log(`    Notice: Alice is gone. The deleted row is no longer visible.`);

console.log(`\n=== Demo Complete ===`);

pool.flushAll();
disk.close();
