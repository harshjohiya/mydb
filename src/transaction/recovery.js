/**
 * Crash Recovery
 * 
 * Implements REDO-only recovery using the Write-Ahead Log.
 * 
 * Recovery strategy:
 *   On restart, read the WAL and replay all INSERT/DELETE entries that
 *   belong to committed transactions (those that have a COMMIT record).
 *   Entries from uncommitted or aborted transactions are simply skipped —
 *   this is our "undo" mechanism: we never re-apply their effects.
 * 
 * NOTE: A real database (ARIES algorithm) also performs an UNDO pass to
 *   roll back loser transactions using undo log records. Our simplified
 *   approach achieves the same correctness guarantee by only re-doing
 *   winners — valid because we never flush dirty pages to disk before their
 *   transaction commits (the WAL "force log before steal" rule).
 */

const WAL = require('./wal');

/**
 * Recovers the database state from a WAL file by replaying all committed
 * transactions onto fresh Catalog + BufferPool instances.
 * 
 * @param {WAL} wal - The WAL instance to read from
 * @param {Catalog} catalog - The (empty) catalog to rebuild into
 * @param {BufferPool} bufferPool - The buffer pool to write recovered data into
 */
function recover(wal, catalog, bufferPool) {
  const redoLog = wal.getRedoLog();

  if (redoLog.length === 0) {
    console.log('[recovery] No committed entries to recover. Starting fresh.');
    return;
  }

  console.log(`[recovery] Replaying ${redoLog.length} committed log entries...`);

  for (const entry of redoLog) {
    if (entry.type === 'INSERT') {
      const { table, data: row } = entry;

      // Ensure the table exists in the catalog. During recovery we may need
      // to create it on-the-fly (since the catalog is in-memory only).
      // Tables are recreated with a placeholder empty columns array —
      // in a real system the schema would be stored in system pages.
      let tableInfo;
      try {
        tableInfo = catalog.getTable(table);
      } catch (_) {
        // Table doesn't exist yet in this fresh catalog — infer columns from the row
        const columns = Object.keys(row).map(name => ({ name, dataType: 'UNKNOWN' }));
        catalog.createTable(table, columns);
        tableInfo = catalog.getTable(table);
      }

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

      if (!targetPage) {
        targetPage = bufferPool.newPage();
        targetPageId = targetPage.pageId;
        catalog.addPage(table, targetPageId);
      }

      const slotIndex = targetPage.writeSlot(rowData);
      bufferPool.unpinPage(targetPageId);

      // Rebuild any indexes
      for (const col of tableInfo.columns) {
        if (catalog.hasIndex(table, col.name)) {
          const idx = catalog.getIndex(table, col.name);
          idx.insert(row[col.name], { pageId: targetPageId, slotIndex });
        }
      }

      console.log(`[recovery]   REDO INSERT into '${table}':`, row);

    } else if (entry.type === 'DELETE') {
      const { table, data: { recordId, row } } = entry;

      // Re-apply the deletion on the page
      try {
        const page = bufferPool.getPage(recordId.pageId);
        page.deleteSlot(recordId.slotIndex);
        bufferPool.unpinPage(recordId.pageId);
      } catch (_) {
        // Page may not exist if recovery is partial; skip silently
      }

      // Remove from any indexes
      try {
        const tableInfo = catalog.getTable(table);
        for (const col of tableInfo.columns) {
          if (catalog.hasIndex(table, col.name)) {
            const idx = catalog.getIndex(table, col.name);
            idx.delete(row[col.name]);
          }
        }
      } catch (_) {
        // Table may not have been created yet in this recovery run; skip
      }

      console.log(`[recovery]   REDO DELETE from '${table}':`, row);
    }
  }

  console.log('[recovery] Recovery complete.');
}

module.exports = { recover };
