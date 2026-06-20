const readline = require('readline');
const path = require('path');
const fs = require('fs');

const Catalog = require('./catalog');
const DiskManager = require('./storage/disk-manager');
const BufferPool = require('./storage/buffer-pool');
const TransactionManager = require('./transaction/transaction-manager');
const WAL = require('./transaction/wal');
const { tokenize } = require('./sql/lexer');
const { Parser } = require('./sql/parser');
const {
  executeWithMVCC,
  beginMVCCTransaction,
  commitMVCCTransaction,
  rollbackMVCCTransaction
} = require('./executor/executor');
const { formatRowsAsTable } = require('./repl-format');

const DB_PATH = path.join(__dirname, '..', 'data', 'mydb.db');
const WAL_PATH = path.join(__dirname, '..', 'data', 'mydb.wal');

// Setup core components
const disk = new DiskManager(DB_PATH);
const pool = new BufferPool(disk, 10);
const catalog = new Catalog();
const wal = new WAL(WAL_PATH);
const txnManager = new TransactionManager();

let currentTxnId = null;

const banner = `
========================================================================
                          mydb REPL
========================================================================
This is mydb, a hand-built relational engine.
Type HELP for a list of commands.

LIMITATION: Table schemas are NOT persisted yet! 
You must re-run your CREATE TABLE statements each time you start a new 
session.
========================================================================
`;

console.log(banner);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'mydb> '
});

rl.prompt();

rl.on('line', (line) => {
  let input = line.trim();
  
  if (input.endsWith(';')) {
    input = input.slice(0, -1).trim();
  }

  if (!input) {
    rl.prompt();
    return;
  }

  const upperInput = input.toUpperCase();

  if (upperInput === 'EXIT' || upperInput === 'QUIT') {
    pool.flushAll();
    disk.close();
    process.exit(0);
  }

  if (upperInput === 'HELP') {
    console.log(`
Supported Commands:
  CREATE TABLE users (id INT, name VARCHAR, age INT)
  INSERT INTO users VALUES (1, 'Alice', 25)
  SELECT * FROM users WHERE age > 20
  DELETE FROM users WHERE id = 1
  BEGIN
  COMMIT
  ROLLBACK
  HELP
  EXIT / QUIT
    `);
    rl.prompt();
    return;
  }

  if (upperInput === 'BEGIN') {
    if (currentTxnId !== null) {
      console.log('Error: already inside a transaction');
    } else {
      currentTxnId = beginMVCCTransaction(wal, txnManager);
      console.log(`BEGIN (txnId: ${currentTxnId})`);
    }
    rl.prompt();
    return;
  }

  if (upperInput === 'COMMIT') {
    if (currentTxnId === null) {
      console.log('Error: not inside a transaction');
    } else {
      commitMVCCTransaction(wal, txnManager, currentTxnId);
      console.log('COMMIT');
      currentTxnId = null;
    }
    rl.prompt();
    return;
  }

  if (upperInput === 'ROLLBACK') {
    if (currentTxnId === null) {
      console.log('Error: not inside a transaction');
    } else {
      rollbackMVCCTransaction(wal, txnManager, currentTxnId);
      console.log('ROLLBACK');
      currentTxnId = null;
    }
    rl.prompt();
    return;
  }

  // Otherwise, treat as SQL
  try {
    const tokens = tokenize(input);
    const ast = new Parser(tokens).parse();

    if (currentTxnId !== null) {
      // Explicit transaction in progress
      const result = executeWithMVCC(ast, catalog, pool, wal, txnManager, currentTxnId);
      if (ast.type === 'SELECT') {
        console.log(formatRowsAsTable(result));
      } else {
        console.log(result.message);
      }
    } else {
      // Autocommit mode
      const autoTxnId = beginMVCCTransaction(wal, txnManager);
      const result = executeWithMVCC(ast, catalog, pool, wal, txnManager, autoTxnId);
      commitMVCCTransaction(wal, txnManager, autoTxnId);
      
      if (ast.type === 'SELECT') {
        console.log(formatRowsAsTable(result));
      } else {
        console.log(result.message);
      }
    }
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }

  rl.prompt();
});

rl.on('close', () => {
  pool.flushAll();
  disk.close();
  process.exit(0);
});
