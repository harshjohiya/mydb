const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const Catalog = require('../src/catalog');
const DiskManager = require('../src/storage/disk-manager');
const BufferPool = require('../src/storage/buffer-pool');
const WAL = require('../src/transaction/wal');
const { recover } = require('../src/transaction/recovery');
const { tokenize } = require('../src/sql/lexer');
const { Parser } = require('../src/sql/parser');
const { execute } = require('../src/executor/executor');

const DB_PATH = path.join(__dirname, '..', 'data', 'bench-crash.db');
const WAL_PATH = path.join(__dirname, '..', 'data', 'bench-crash.wal');

function parse(sql) {
  return new Parser(tokenize(sql)).parse();
}

function cleanup() {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  if (fs.existsSync(WAL_PATH)) fs.unlinkSync(WAL_PATH);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runBenchmark() {
  cleanup();

  console.log("Spawning worker process...");
  const workerPath = path.join(__dirname, '_crash-worker.js');
  const child = spawn('node', [workerPath]);

  // Wait to let worker commit its first txn and start its second
  await wait(1000);

  console.log("Force-killing worker process (SIGKILL) to simulate a crash...");
  child.kill('SIGKILL');

  // Wait to ensure the OS has fully torn down the process
  await wait(500);

  console.log("Recovering...");
  
  const disk = new DiskManager(DB_PATH);
  const pool = new BufferPool(disk, 50);
  const catalog = new Catalog();
  const wal = new WAL(WAL_PATH);

  // Recreate the "logs" table schema (documented limitation)
  catalog.createTable('logs', [
    { name: 'id', dataType: 'INT' },
    { name: 'message', dataType: 'VARCHAR', length: 255 }
  ]);

  const result = recover(wal, catalog, pool);
  console.log(`Recovery complete: replayed ${result.insertsReplayed} inserts, skipped ${result.deletesSkipped} deletes.`);

  const rows = execute(parse("SELECT * FROM logs"), catalog, pool);
  console.log("Data in 'logs' table after recovery:");
  console.log(rows);

  console.log("\n==============================================");
  console.log("                 SUMMARY                      ");
  console.log("==============================================");

  let passed = false;
  if (rows.length === 3) {
    const hasUncommitted = rows.some(r => r.id === 4);
    if (!hasUncommitted) {
      passed = true;
    }
  }

  if (passed) {
    console.log(`RESULT: ✅ PASS. Exactly 3 committed rows recovered; uncommitted row absent.`);
    process.exitCode = 0;
  } else {
    console.log(`RESULT: ❌ FAIL. Expected 3 rows, found ${rows.length}. Check for uncommitted row.`);
    process.exitCode = 1;
  }

  pool.flushAll();
  disk.close();
  cleanup();
}

runBenchmark();
