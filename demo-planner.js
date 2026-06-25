const fs = require('fs');
const path = require('path');

const Catalog = require('./src/catalog');
const DiskManager = require('./src/storage/disk-manager');
const BufferPool = require('./src/storage/buffer-pool');
const { tokenize } = require('./src/sql/lexer');
const { Parser } = require('./src/sql/parser');
const { execute } = require('./src/executor/executor');

const DB_PATH = path.join(__dirname, 'data', 'mydb-week7.db');

function cleanup() {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
}

function parse(sql) {
  return new Parser(tokenize(sql)).parse();
}

function runDemo() {
  cleanup();

  console.log("1. Setting up Catalog and BufferPool at data/mydb-week7.db...");
  const disk = new DiskManager(DB_PATH);
  const pool = new BufferPool(disk, 10);
  const catalog = new Catalog();

  // Added a filler column to ensure the table spans enough pages to make
  // sequential scans costly, allowing the cost estimator to properly 
  // weigh index traversal vs full table scans.
  catalog.createTable('users', [
    { name: 'id', dataType: 'INT' },
    { name: 'name', dataType: 'VARCHAR', length: 100 },
    { name: 'age', dataType: 'INT' },
    { name: 'filler', dataType: 'VARCHAR', length: 1000 }
  ]);
  catalog.createIndex('users', 'age');

  console.log("\n2. Inserting 30 users with skewed ages (25 with age=40, 5 unique)...");
  const padding = "'" + "x".repeat(1000) + "'";

  let id = 1;
  // Insert 25 common values
  for (let i = 0; i < 25; i++) {
    execute(parse(`INSERT INTO users VALUES (${id++}, 'User${id}', 40, ${padding})`), catalog, pool);
  }
  // Insert 5 rare values
  const scatteredAges = [22, 35, 50, 60, 70];
  for (const age of scatteredAges) {
    execute(parse(`INSERT INTO users VALUES (${id++}, 'User${id}', ${age}, ${padding})`), catalog, pool);
  }

  console.log("\n3. Running SELECT * FROM users WHERE age = 70 (a rare value)...");
  let res1 = execute(parse("SELECT * FROM users WHERE age = 70"), catalog, pool);
  console.log(`=> Result count: ${res1.length}`);

  console.log("\n4. Running SELECT * FROM users WHERE age = 40 (the common value, 25/30 rows)...");
  let res2 = execute(parse("SELECT * FROM users WHERE age = 40"), catalog, pool);
  console.log(`=> Result count: ${res2.length}`);

  console.log("\n5. Notice: the exact same index existed in both queries — the planner chose differently based on estimated SELECTIVITY, not just whether an index was available.");

  console.log("\n6. Flushing buffer pool and closing disk manager...");
  pool.flushAll();
  disk.close();
}

runDemo();
