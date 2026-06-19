/**
 * MVCC — Multi-Version Concurrency Control
 *
 * Instead of locking rows, MVCC lets every writer create a new *version*
 * of a row.  Readers decide which version to see based on transaction
 * status, so readers never block writers and writers never block readers.
 *
 * On-disk row format (versioned wrapper):
 *   {
 *     createdByTxn:  <txnId>,          // who inserted this version
 *     deletedByTxn:  <txnId | null>,   // who marked it deleted (null = alive)
 *     data:          <actual row obj>   // the real columns (id, name, …)
 *   }
 *
 * ─────────────────────────────────────────────────────────────────────
 * ISOLATION LEVEL: READ COMMITTED
 *
 *   isVisible() checks the LIVE, current status of the creating /
 *   deleting transaction every time it is called.  This means:
 *
 *     • A row that was invisible a moment ago (creator still active)
 *       becomes visible the instant the creator commits — even inside
 *       an already-running reader transaction.
 *
 *   This is "read committed" semantics: you always see the latest
 *   committed state, but two reads within the same transaction can
 *   return different results if another transaction commits in between
 *   (a "non-repeatable read").
 *
 *   Upgrading to true SNAPSHOT ISOLATION is a great next exercise:
 *     1. At BEGIN time, record a snapshot — a frozen Set of all txnIds
 *        that are currently committed.
 *     2. In isVisible(), check against that frozen set instead of
 *        calling txnManager.isCommitted() live.
 *     3. This way a transaction always sees a stable point-in-time view
 *        of the database, regardless of concurrent commits.
 *
 * ─────────────────────────────────────────────────────────────────────
 * WHY ROLLBACK IS "FREE"
 *
 *   When a transaction aborts, txnManager sets its status to "ABORTED".
 *   From that moment on, isCommitted() permanently returns false for
 *   that txnId.  Since isVisible() requires the creator to be committed
 *   (for rows you didn't create yourself), the aborted transaction's
 *   writes are simply invisible to every other transaction — forever.
 *
 *   No explicit undo of data is needed.  The leftover versioned rows
 *   are dead weight (garbage) that a real database would reclaim later
 *   via a background process called "VACUUM" (PostgreSQL) or "purge"
 *   (InnoDB).  We don't implement vacuum here — that's another great
 *   future exercise.
 * ─────────────────────────────────────────────────────────────────────
 */

/**
 * Wraps a plain row object in the versioned envelope that MVCC expects.
 *
 * @param {Object} row    – The actual row data ({ id: 1, name: 'Alice', … })
 * @param {number} txnId  – The transaction that is creating this row
 * @returns {{ createdByTxn: number, deletedByTxn: null, data: Object }}
 */
function wrapRow(row, txnId) {
  return {
    createdByTxn: txnId,
    deletedByTxn: null,
    data: row,
  };
}

/**
 * Determines whether `currentTxnId` should see `versionedRow`.
 *
 * @param {{ createdByTxn: number, deletedByTxn: number|null, data: Object }} versionedRow
 * @param {number} currentTxnId – The transaction asking "can I see this?"
 * @param {TransactionManager} txnManager – Provides live status lookups
 * @returns {boolean}
 */
function isVisible(versionedRow, currentTxnId, txnManager) {
  const createdByMe      = versionedRow.createdByTxn === currentTxnId;
  const creatorCommitted = txnManager.isCommitted(versionedRow.createdByTxn);

  // ── Creation check ──────────────────────────────────────────────
  // You can't see rows created by someone else's transaction that
  // hasn't committed yet — this is what prevents dirty reads.
  if (!createdByMe && !creatorCommitted) {
    return false;
  }

  // ── Deletion check ──────────────────────────────────────────────
  if (versionedRow.deletedByTxn !== null) {
    // You deleted it yourself — it's gone as far as you're concerned.
    if (versionedRow.deletedByTxn === currentTxnId) {
      return false;
    }

    // Someone else's committed delete removed it.
    if (txnManager.isCommitted(versionedRow.deletedByTxn)) {
      return false;
    }

    // Otherwise the deleter is still active or has aborted (and isn't
    // you) — the delete hasn't "taken effect" yet, so the row is
    // still visible.  Fall through to return true.
  }

  return true;
}

module.exports = { wrapRow, isVisible };
