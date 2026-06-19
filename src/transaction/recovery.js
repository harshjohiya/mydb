/**
 * Crash Recovery
 *
 * Implements REDO-only recovery using the Write-Ahead Log.
 *
 * Recovery strategy:
 *   On restart, read the WAL and replay all INSERT entries that belong to
 *   committed transactions. DELETE entries are intentionally skipped —
 *   see the detailed explanation below.
 *
 * NOTE on UNDO: A real database (ARIES) also performs an UNDO pass to roll
 *   back loser transactions. Our approach avoids this by only re-doing
 *   committed winners — valid so long as we never flush dirty pages before
 *   their transaction commits (WAL "no-steal" rule).
 */

/**
 * Replays a WAL's redo log against a catalog + buffer pool after a restart.
 *
 * @param {WAL} wal
 * @param {Catalog} catalog
 * @param {BufferPool} bufferPool
 * @returns {{ insertsReplayed: number, deletesSkipped: number }}
 */
function recover(wal, catalog, bufferPool) {
  const redoLog = wal.getRedoLog();

  let insertsReplayed = 0;
  let deletesSkipped = 0;

  for (const entry of redoLog) {
    if (entry.type === 'INSERT') {
      const { table, data: row } = entry;
      const tableInfo = catalog.getTable(table);

      const rowData = JSON.stringify(row);
      const rowLen = Buffer.byteLength(rowData, 'utf8');

      let targetPage = null;
      let targetPageId = null;

      // Find a page with room
      for (const pid of tableInfo.pageIds) {
        const page = bufferPool.getPage(pid);
        if (page.hasSpaceFor(rowLen)) {
          targetPage = page;
          targetPageId = pid;
          break;
        } else {
          bufferPool.unpinPage(pid);
        }
      }

      // No suitable page found — allocate a new one
      if (!targetPage) {
        targetPage = bufferPool.newPage();
        targetPageId = targetPage.pageId;
        catalog.addPage(table, targetPageId);
      }

      const slotIndex = targetPage.writeSlot(rowData);
      bufferPool.unpinPage(targetPageId);

      // Rebuild any indexes for this table
      for (const col of tableInfo.columns) {
        if (catalog.hasIndex(table, col.name)) {
          const idx = catalog.getIndex(table, col.name);
          idx.insert(row[col.name], { pageId: targetPageId, slotIndex });
        }
      }

      insertsReplayed++;

    } else if (entry.type === 'DELETE') {
      /*
       * DELETE entries are intentionally NOT replayed during recovery.
       *
       * Why: We are doing LOGICAL redo (re-inserting rows from the WAL),
       * NOT PHYSICAL redo (replaying byte-level page modifications at stable
       * addresses). During recovery, each INSERT re-lands the row on whatever
       * page currently has free space — which almost certainly differs from
       * the original { pageId, slotIndex } that was recorded in the DELETE
       * log entry. If we tried to replay the DELETE using its stored recordId,
       * we would corrupt the wrong slot (or crash) instead of removing the
       * intended row.
       *
       * Doing this correctly requires PHYSICAL redo: every page stores the
       * LSN of the last WAL entry applied to it (a "pageLSN"), and the
       * recovery pass uses those LSNs to replay modifications at their exact
       * original byte offsets — exactly how real WAL systems (PostgreSQL,
       * InnoDB, SQLite WAL mode) work. That is a great advanced exercise.
       *
       * Practical consequence: after a crash that occurred AFTER a DELETE was
       * committed, the deleted row will reappear in the recovered database.
       * For this educational implementation, this is an accepted limitation.
       */
      console.warn(
        `[recovery] Skipping DELETE entry (lsn=${entry.lsn}, txnId=${entry.txnId}, ` +
        `table=${entry.data ? entry.data.row && entry.data.row.id : '?'}) — ` +
        'logical redo cannot safely replay deletes without physical page addressing.'
      );
      deletesSkipped++;
    }
  }

  return { insertsReplayed, deletesSkipped };
}

module.exports = { recover };
