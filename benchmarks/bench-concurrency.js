const fs = require('fs');
const path = require('path');

const Catalog = require('../src/catalog');
const DiskManager = require('../src/storage/disk-manager');
const BufferPool = require('../src/storage/buffer-pool');
const TransactionManager = require('../src/transaction/transaction-manager');
const WAL = require('../src/transaction/wal');
const { tokenize } = require('../src/sql/lexer');
const { Parser } = require('../src/sql/parser');
const {
  executeWithMVCC,
  beginMVCCTransaction,
  commitMVCCTransaction
} = require('../src/executor/executor');

const DB_PATH = path.join(__dirname, '..', 'data', 'bench-concurrency.db');
const WAL_PATH = path.join(__dirname, '..', 'data', 'bench-concurrency.wal');

function cleanup() {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  if (fs.existsSync(WAL_PATH)) fs.unlinkSync(WAL_PATH);
}

function parse(sql) {
  return new Parser(tokenize(sql)).parse();
}

function runBenchmark() {
  cleanup();
  
  console.log("Setting up DB for MVCC Concurrency Test...");
  const disk = new DiskManager(DB_PATH);
  const pool = new BufferPool(disk, 50);
  const catalog = new Catalog();
  const wal = new WAL(WAL_PATH);
  const txnManager = new TransactionManager();

  // 1. Set up a fresh "accounts" table
  catalog.createTable('accounts', [
    { name: 'id', dataType: 'INT' },
    { name: 'balance', dataType: 'INT' }
  ]);

  let passed = 0;
  let failed = 0;

  console.log("\n--- Starting Test ---");

  // 2. txnA inserts a row but does not commit
  const txnA = beginMVCCTransaction(wal, txnManager);
  console.log(`[TxnA] Started (id: ${txnA})`);
  executeWithMVCC(parse("INSERT INTO accounts VALUES (1, 100)"), catalog, pool, wal, txnManager, txnA);
  console.log(`[TxnA] Inserted (id=1, balance=100), but NOT COMMITTED yet.`);

  // 3. txnB starts concurrently and reads
  const txnB = beginMVCCTransaction(wal, txnManager);
  console.log(`[TxnB] Started concurrently (id: ${txnB})`);
  
  const resB1 = executeWithMVCC(parse("SELECT * FROM accounts"), catalog, pool, wal, txnManager, txnB);
  if (resB1.length > 0) {
    console.log(`❌ FAILED: dirty read occurred (TxnB saw TxnA's uncommitted row)`);
    failed++;
  } else {
    console.log(`✅ PASSED: txnB correctly could not see txnA's uncommitted insert`);
    passed++;
  }

  // 4. txnA commits
  console.log(`\n[TxnA] Committing now...`);
  commitMVCCTransaction(wal, txnManager, txnA);
  console.log(`[TxnA] Committed.`);

  // 5. txnC starts after txnA commits and reads
  const txnC = beginMVCCTransaction(wal, txnManager);
  console.log(`\n[TxnC] Started after TxnA commit (id: ${txnC})`);
  
  const resC1 = executeWithMVCC(parse("SELECT * FROM accounts"), catalog, pool, wal, txnManager, txnC);
  if (resC1.length > 0) {
    console.log(`✅ PASSED: txnC correctly sees txnA's committed data`);
    passed++;
  } else {
    console.log(`❌ FAILED: committed data should be visible to TxnC`);
    failed++;
  }

  // 6. txnB reads again
  console.log(`\n[TxnB] Reading again (still open from earlier)...`);
  const resB2 = executeWithMVCC(parse("SELECT * FROM accounts"), catalog, pool, wal, txnManager, txnB);
  console.log(`[TxnB] Found ${resB2.length} rows.`);
  console.log(`       Note: Under this read-committed-style MVCC model, TxnB WILL now see`);
  console.log(`       the newly committed row, even though it didn't see it earlier.`);
  console.log(`       This is a known characteristic of read-committed isolation.`);

  // Cleanup
  pool.flushAll();
  disk.close();
  cleanup();

  // 7. Final Summary
  console.log(`\n==============================================`);
  console.log(`                 SUMMARY                      `);
  console.log(`==============================================`);
  if (failed > 0) {
    console.log(`RESULT: ❌ ${failed} failed, ${passed} passed`);
    process.exitCode = 1;
  } else {
    console.log(`RESULT: ✅ All ${passed} tests passed successfully`);
    process.exitCode = 0;
  }
}

runBenchmark();
