/**
 * Write-Ahead Log (WAL)
 * 
 * Provides durability guarantees by writing log entries to an append-only
 * file BEFORE changes are applied to the actual data pages.
 * 
 * Log entry format: { lsn, txnId, type, table, data, timestamp }
 * Entry types: "BEGIN", "INSERT", "DELETE", "COMMIT", "ABORT"
 * 
 * One JSON object per line (newline-delimited JSON).
 */

const fs = require('fs');
const path = require('path');

class WAL {
  constructor(walFilePath) {
    this.walFilePath = walFilePath;
    this.nextLSN = 1;

    // Ensure parent directory exists
    const dir = path.dirname(walFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // If WAL file already exists, read it to find the highest LSN
    // so we keep incrementing correctly across restarts
    if (fs.existsSync(walFilePath)) {
      const existing = this.readAll();
      if (existing.length > 0) {
        const maxLSN = Math.max(...existing.map(e => e.lsn));
        this.nextLSN = maxLSN + 1;
      }
    } else {
      // Create an empty WAL file
      fs.writeFileSync(walFilePath, '', 'utf8');
    }
  }

  /**
   * Private helper: assigns lsn + timestamp to the entry, then appends
   * it as a JSON line to the WAL file.
   * 
   * NOTE: A real database calls fsync() after every write here to guarantee
   * durability — the OS must flush its write buffer to physical disk before
   * acknowledging the write to the caller. appendFileSync is "good enough"
   * for our educational purposes (it issues the write syscall synchronously),
   * but it does NOT call fsync, so in theory the OS could buffer the data
   * and lose it on a power failure before it hits disk.
   */
  _appendEntry(entry) {
    entry.lsn = this.nextLSN++;
    entry.timestamp = Date.now();
    fs.appendFileSync(this.walFilePath, JSON.stringify(entry) + '\n', 'utf8');
  }

  logBegin(txnId) {
    this._appendEntry({ txnId, type: 'BEGIN' });
  }

  logInsert(txnId, table, row) {
    this._appendEntry({ txnId, type: 'INSERT', table, data: row });
  }

  logDelete(txnId, table, recordId, row) {
    this._appendEntry({ txnId, type: 'DELETE', table, data: { recordId, row } });
  }

  logCommit(txnId) {
    this._appendEntry({ txnId, type: 'COMMIT' });
  }

  logAbort(txnId) {
    this._appendEntry({ txnId, type: 'ABORT' });
  }

  /**
   * Reads the entire WAL file and returns an array of parsed log entries.
   */
  readAll() {
    if (!fs.existsSync(this.walFilePath)) {
      return [];
    }
    const content = fs.readFileSync(this.walFilePath, 'utf8');
    return content
      .split('\n')
      .filter(line => line.trim() !== '')
      .map(line => JSON.parse(line));
  }

  /**
   * Returns a Set of txnIds that have a COMMIT entry in the log.
   */
  getCommittedTxnIds() {
    const entries = this.readAll();
    const committed = new Set();
    for (const entry of entries) {
      if (entry.type === 'COMMIT') {
        committed.add(entry.txnId);
      }
    }
    return committed;
  }

  /**
   * Returns only the INSERT and DELETE entries for committed transactions,
   * in original LSN order. This is the redo log used during crash recovery.
   * 
   * Entries from uncommitted or aborted transactions are excluded — 
   * this is how we effectively "undo" incomplete transactions: we simply
   * never redo their effects on the data pages.
   */
  getRedoLog() {
    const entries = this.readAll();
    const committedTxnIds = this.getCommittedTxnIds();

    return entries.filter(entry =>
      (entry.type === 'INSERT' || entry.type === 'DELETE') &&
      committedTxnIds.has(entry.txnId)
    );
  }
}

module.exports = WAL;
