# mydb

A relational database engine built from scratch in Node.js, layer by layer, over 8 weeks — implementing a slotted-page storage engine, B+ Tree indexing, a SQL lexer/parser, a cost-based query planner, write-ahead logging with crash recovery, and MVCC transaction isolation.

## Project Structure

```text
mydb/
├── benchmarks/
│   ├── _crash-worker.js
│   ├── bench-concurrency.js
│   ├── bench-crash-recovery.js
│   └── bench-scan.js
├── data/
│   └── (Database and WAL files are stored here)
├── src/
│   ├── executor/
│   │   ├── eval-condition.js
│   │   ├── executor.js
│   │   ├── index-scan.js
│   │   └── seq-scan.js
│   ├── index/
│   │   └── btree.js
│   ├── sql/
│   │   ├── cost-estimator.js
│   │   ├── lexer.js
│   │   ├── parser.js
│   │   └── planner.js
│   ├── storage/
│   │   ├── buffer-pool.js
│   │   ├── disk-manager.js
│   │   └── page.js
│   ├── transaction/
│   │   ├── mvcc.js
│   │   ├── recovery.js
│   │   ├── transaction-manager.js
│   │   └── wal.js
│   ├── catalog.js
│   ├── repl-format.js
│   └── repl.js
├── tests/
│   ├── test-week1.js
│   ├── test-week2.js
│   ├── test-week3.js
│   ├── test-week4.js
│   ├── test-week5.js
│   ├── test-week6.js
│   └── test-week7.js
├── demo-week7.js
├── package.json
└── README.md
```

## Setup Instructions

1. Install dependencies (if any):
   ```bash
   npm install
   ```

2. Start the interactive REPL:
   ```bash
   npm start
   ```

## Features

- **Storage Engine**: A slotted-page storage architecture handling file reads/writes, wrapped by an in-memory LRU Buffer Pool.
- **B+ Tree Indexing**: Implemented `BPlusTree` indexing for fast lookups, insertions, and logarithmic `O(log N)` complexity.
- **SQL Parsing**: A custom Lexer and recursive-descent Parser producing a structural Abstract Syntax Tree (AST).
- **Cost-Based Query Planner**: Evaluates disk I/O costs to selectively choose between a sequential scan and an index scan based on data selectivity.
- **WAL & Crash Recovery**: A Write-Ahead Log to record mutations, ensuring durability and the ability to rebuild the database after a hard crash (replaying committed rows and skipping uncommitted ones).
- **MVCC Isolation**: Multi-Version Concurrency Control providing read-committed transactional isolation without blocking concurrent reads.

## Running the Test Suite

The project includes unit and integration tests tracking the progress of each week:

```bash
npm run test:week1
npm run test:week2
npm run test:week3
npm run test:week4
npm run test:week5
npm run test:week6
npm run test:week7
```

## Benchmarks

The `benchmarks/` directory contains standalone scripts profiling the characteristics of the database:

### 1. `bench:scan`
Proves the index scan speedup. Profiles `seqScan` vs `indexScan` on a highly selective query against padded rows spanning multiple disk pages.
```bash
npm run bench:scan
```
*Results:*
```text
[paste your output here]
```

### 2. `bench:concurrency`
Proves MVCC isolation. Runs concurrent transactions reading and writing simultaneously, verifying that a dirty read does not occur and committed data is accurately observed.
```bash
npm run bench:concurrency
```
*Results:*
```text
[paste your output here]
```

### 3. `bench:crash`
Proves crash resilience. Spawns a dedicated worker process running a transaction, forcibly kills it (`SIGKILL`) midway through a secondary uncommitted transaction, and verifies the exact committed state using the WAL.
```bash
npm run bench:crash
```
*Results:*
```text
[paste your output here]
```

## Known Limitations / Future Exercises

As a pedagogical project built over an 8-week period, certain compromises and simplifications were intentionally made:
- **Ephemeral Schemas**: Table schemas (the catalog) are not persisted across restarts; `CREATE TABLE` must be re-run each session.
- **No Vacuuming**: Deleted physical slots and old MVCC row versions are never compacted or reclaimed.
- **Read-Committed MVCC**: The MVCC implementation operates closer to "read-committed" style rather than true snapshot isolation.
- **Logical Redo Recovery**: The WAL recovery does logical (not physical) redo and skips replaying deletes.
- **Single Process**: The architecture expects single-process usage. There is no concurrent multi-process access support (single Node process only).

## Resume

If you are incorporating this project into your resume, you can use the following bullet point:

> **Engineered a relational database engine in Node.js featuring a B+ Tree index, WAL-based crash recovery, MVCC transaction isolation, a cost-based query planner, and a custom SQL parser (lexer → AST → execution) supporting SELECT, INSERT, DELETE, and transactions.**
