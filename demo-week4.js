const path = require('path');
const Catalog = require('./src/catalog');
const DiskManager = require('./src/storage/disk-manager');
const BufferPool = require('./src/storage/buffer-pool');
const { tokenize } = require('./src/sql/lexer');
const { Parser } = require('./src/sql/parser');
const { execute } = require('./src/executor/executor');

const dbFilePath = path.join(__dirname, 'data', 'mydb.db');

// Helper to quickly run SQL and return the result
function runQuery(sql, catalog, bufferPool) {
  console.log(`\n> ${sql}`);
  const tokens = tokenize(sql);
  const ast = new Parser(tokens).parse();
  return execute(ast, catalog, bufferPool);
}

function runDemo() {
  console.log('--- mydb Week 4 Demo ---');
  
  // Setup Storage & Catalog
  const diskManager = new DiskManager(dbFilePath);
  const bufferPool = new BufferPool(diskManager, 10);
  const catalog = new Catalog();

  console.log('\n--- Step 1: CREATE TABLE ---');
  console.log('We will create a users table with id, name, and age columns.');
  const createRes = runQuery("CREATE TABLE users (id INT, name VARCHAR(100), age INT)", catalog, bufferPool);
  console.log('Result:', createRes);

  console.log('\n--- Step 2: CREATE INDEX ---');
  console.log('We will explicitly create a B+ Tree index on the "age" column.');
  catalog.createIndex('users', 'age');
  console.log('Index created on users.age.');

  console.log('\n--- Step 3: INSERT ROWS ---');
  console.log('We will insert 5 users with varied ages.');
  runQuery("INSERT INTO users VALUES (1, 'Alice', 20)", catalog, bufferPool);
  runQuery("INSERT INTO users VALUES (2, 'Bob', 30)", catalog, bufferPool);
  runQuery("INSERT INTO users VALUES (3, 'Charlie', 22)", catalog, bufferPool);
  runQuery("INSERT INTO users VALUES (4, 'Diana', 45)", catalog, bufferPool);
  runQuery("INSERT INTO users VALUES (5, 'Eve', 65)", catalog, bufferPool);

  console.log('\n--- Step 4: SELECT WITH INDEX SCAN ---');
  console.log('We will fetch users over 25. The planner should automatically detect the index and use it.');
  const select1 = runQuery("SELECT * FROM users WHERE age > 25", catalog, bufferPool);
  console.log('Result:', select1);

  console.log('\n--- Step 5: SELECT WITH COMPLEX CONDITION ---');
  console.log('We will fetch users between 25 and 60. The planner will use the index for the first bound, and post-filter the rest.');
  const select2 = runQuery("SELECT name FROM users WHERE age > 25 AND age < 60", catalog, bufferPool);
  console.log('Result:', select2);

  console.log('\n--- Step 6: DELETE USING INDEX ---');
  console.log('We will delete users over 60. The system will find them via index scan and remove them.');
  const deleteRes = runQuery("DELETE FROM users WHERE age > 60", catalog, bufferPool);
  console.log('Result:', deleteRes);

  console.log('\n--- Step 7: FINAL SELECT ---');
  console.log('We will fetch all remaining rows via sequential scan to prove Eve is gone.');
  const select3 = runQuery("SELECT * FROM users", catalog, bufferPool);
  console.log('Result:', select3);

  console.log('\n--- Step 8: CLEANUP ---');
  console.log('Flushing buffer pool and closing disk manager.');
  bufferPool.flushAll();
  diskManager.close();
  console.log('Demo completed successfully.');
}

runDemo();
