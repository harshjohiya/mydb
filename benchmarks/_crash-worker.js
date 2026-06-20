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

const DB_PATH = path.join(__dirname, '..', 'data', 'bench-crash.db');
const WAL_PATH = path.join(__dirname, '..', 'data', 'bench-crash.wal');

function parse(sql) {
  return new Parser(tokenize(sql)).parse();
}

function runWorker() {
  const disk = new DiskManager(DB_PATH);
  const pool = new BufferPool(disk, 50);
  const catalog = new Catalog();
  const wal = new WAL(WAL_PATH);
  const txnManager = new TransactionManager();

  catalog.createTable('logs', [
    { name: 'id', dataType: 'INT' },
    { name: 'message', dataType: 'VARCHAR', length: 255 }
  ]);

  // Txn 1: Committed
  const txn1 = beginMVCCTransaction(wal, txnManager);
  executeWithMVCC(parse("INSERT INTO logs VALUES (1, 'Log 1')"), catalog, pool, wal, txnManager, txn1);
  executeWithMVCC(parse("INSERT INTO logs VALUES (2, 'Log 2')"), catalog, pool, wal, txnManager, txn1);
  executeWithMVCC(parse("INSERT INTO logs VALUES (3, 'Log 3')"), catalog, pool, wal, txnManager, txn1);
  commitMVCCTransaction(wal, txnManager, txn1);

  // Txn 2: Uncommitted
  const txn2 = beginMVCCTransaction(wal, txnManager);
  executeWithMVCC(parse("INSERT INTO logs VALUES (4, 'Uncommitted Log')"), catalog, pool, wal, txnManager, txn2);

  // Keep the process alive so the parent can force-kill it
  setInterval(() => {
    // idle loop
  }, 1000);
}

runWorker();
