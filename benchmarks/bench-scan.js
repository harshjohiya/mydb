const fs = require('fs');
const path = require('path');

const Catalog = require('../src/catalog');
const DiskManager = require('../src/storage/disk-manager');
const BufferPool = require('../src/storage/buffer-pool');
const { execute } = require('../src/executor/executor');
const { seqScan } = require('../src/executor/seq-scan');
const { indexScan } = require('../src/executor/index-scan');

const DB_PATH = path.join(__dirname, '..', 'data', 'bench-scan.db');

function cleanup() {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
}

function runBenchmark() {
  cleanup();
  
  console.log("Setting up DB...");
  const disk = new DiskManager(DB_PATH);
  const pool = new BufferPool(disk, 50);
  const catalog = new Catalog();

  catalog.createTable('users', [
    { name: 'id', dataType: 'INT' },
    { name: 'name', dataType: 'VARCHAR', length: 100 },
    { name: 'age', dataType: 'INT' },
    // A filler column to ensure rows span multiple pages, 
    // making seq scan realistically costly.
    { name: 'filler', dataType: 'VARCHAR', length: 500 }
  ]);
  catalog.createIndex('users', 'age');

  console.log("Inserting 5000 rows...");
  const padding = "'" + "x".repeat(500) + "'";
  for (let i = 0; i < 5000; i++) {
    const age = i === 4500 ? 999999 : Math.floor(Math.random() * 1000);
    const ast = {
      type: "INSERT",
      table: "users",
      values: [i, `User${i}`, age, padding]
    };
    execute(ast, catalog, pool);
  }

  // Ensure all data is flushed and pages aren't just residing in memory
  pool.flushAll();

  const whereAst = { type: "COMPARISON", left: "age", op: "=", right: 999999 };
  const runs = 5;

  console.log("Benchmarking Seq Scan...");
  let seqTotalMs = 0;
  let seqMatches = 0;
  for (let i = 0; i < runs; i++) {
    const start = process.hrtime.bigint();
    const results = seqScan(catalog, pool, 'users', whereAst);
    const end = process.hrtime.bigint();
    seqTotalMs += Number(end - start) / 1_000_000;
    seqMatches = results.length;
  }
  const seqAvgMs = seqTotalMs / runs;

  console.log("Benchmarking Index Scan...");
  let indexTotalMs = 0;
  let indexMatches = 0;
  for (let i = 0; i < runs; i++) {
    const start = process.hrtime.bigint();
    const results = indexScan(catalog, pool, 'users', 'age', whereAst);
    const end = process.hrtime.bigint();
    indexTotalMs += Number(end - start) / 1_000_000;
    indexMatches = results.length;
  }
  const indexAvgMs = indexTotalMs / runs;

  console.log("\n==============================================");
  console.log("             SCAN BENCHMARK RESULTS           ");
  console.log("==============================================");
  console.log(`Rows Scanned    : 5000`);
  console.log(`Seq Scan Avg    : ${seqAvgMs.toFixed(3)} ms`);
  console.log(`Index Scan Avg  : ${indexAvgMs.toFixed(3)} ms`);
  console.log(`Matches Found   : ${seqMatches} (Seq) / ${indexMatches} (Index)`);
  
  if (indexAvgMs < seqAvgMs && indexAvgMs > 0) {
    const speedup = (seqAvgMs / indexAvgMs).toFixed(1);
    console.log(`Speedup         : ${speedup}x faster`);
  } else {
    console.log(`Speedup         : Seq scan was faster! (Tiny table overhead)`);
  }
  console.log("==============================================\n");

  console.log(`Note: With only 5000 rows across a handful of pages, the speedup 
may be modest (or even reversed for tiny datasets, since hitting 3 B+ Tree 
levels has fixed overhead). The real win shows up as table size grows, 
since seq scan cost grows linearly with page count while index scan stays 
roughly flat. If you want a bigger gap, bump rowCount to 50000+.`);

  disk.close();
  cleanup();
}

runBenchmark();
