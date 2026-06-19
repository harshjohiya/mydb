/**
 * TransactionManager
 *
 * Lightweight in-memory tracker for transaction status.
 *
 * The WAL already durably records BEGIN / COMMIT / ABORT on disk —
 * this class simply makes "what is the status of txn X right now?"
 * queryable in O(1) without re-scanning the log every time.
 *
 * Statuses: "ACTIVE" → "COMMITTED"  (happy path)
 *           "ACTIVE" → "ABORTED"    (rollback path)
 *
 * Usage:
 *   const tm  = new TransactionManager();
 *   const id  = tm.begin();        // → 1
 *   tm.getStatus(id);              // → "ACTIVE"
 *   tm.commit(id);
 *   tm.isCommitted(id);            // → true
 */

class TransactionManager {
  constructor() {
    /** @type {Map<number, string>} txnId → status string */
    this.transactions = new Map();

    /** @type {number} Next txnId to hand out */
    this.nextTxnId = 1;
  }

  /**
   * Begin a new transaction.
   * Assigns a monotonically increasing txnId, marks it ACTIVE.
   * @returns {number} The new txnId
   */
  begin() {
    const txnId = this.nextTxnId++;
    this.transactions.set(txnId, 'ACTIVE');
    return txnId;
  }

  /**
   * Commit an active transaction.
   * @param {number} txnId
   * @throws if the transaction is not currently ACTIVE
   */
  commit(txnId) {
    this._requireActive(txnId);
    this.transactions.set(txnId, 'COMMITTED');
  }

  /**
   * Abort an active transaction.
   * @param {number} txnId
   * @throws if the transaction is not currently ACTIVE
   */
  abort(txnId) {
    this._requireActive(txnId);
    this.transactions.set(txnId, 'ABORTED');
  }

  /**
   * @param {number} txnId
   * @returns {string|undefined} "ACTIVE", "COMMITTED", "ABORTED", or undefined
   */
  getStatus(txnId) {
    return this.transactions.get(txnId);
  }

  /**
   * @param {number} txnId
   * @returns {boolean}
   */
  isCommitted(txnId) {
    return this.transactions.get(txnId) === 'COMMITTED';
  }

  /**
   * @param {number} txnId
   * @returns {boolean}
   */
  isActive(txnId) {
    return this.transactions.get(txnId) === 'ACTIVE';
  }

  // ── internal ────────────────────────────────────────────────────────

  /**
   * Guard: throws unless the given txnId is currently ACTIVE.
   * Catches bugs like double-committing or committing an unknown txn.
   */
  _requireActive(txnId) {
    const status = this.transactions.get(txnId);
    if (status !== 'ACTIVE') {
      throw new Error(
        `Transaction ${txnId} is not ACTIVE (current status: ${status ?? 'unknown'})`
      );
    }
  }
}

module.exports = TransactionManager;
