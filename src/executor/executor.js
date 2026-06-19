const { planAndExecuteScan, planAndExecuteScanMVCC } = require('../sql/planner');
const { wrapRow } = require('../transaction/mvcc');

/**
 * Executes a parsed SQL AST.
 * 
 * @param {Object} ast - The parsed SQL query
 * @param {Catalog} catalog
 * @param {BufferPool} bufferPool
 * @returns {Object|Array} Result of execution
 */
function execute(ast, catalog, bufferPool) {
  switch (ast.type) {
    case 'CREATE_TABLE': {
      catalog.createTable(ast.table, ast.columns);
      return { message: "Table created." };
    }

    case 'INSERT': {
      const tableInfo = catalog.getTable(ast.table);
      
      // Build row object by zipping column names with values
      const row = {};
      for (let i = 0; i < tableInfo.columns.length; i++) {
        row[tableInfo.columns[i].name] = ast.values[i];
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
          bufferPool.unpinPage(pid); // Was not used, unpin immediately
        }
      }

      // If no page found or table is empty, create a new one
      if (!targetPage) {
        targetPage = bufferPool.newPage();
        targetPageId = targetPage.pageId;
        catalog.addPage(ast.table, targetPageId);
      }

      const slotIndex = targetPage.writeSlot(rowData);
      
      // We must unpin the target page when done writing
      bufferPool.unpinPage(targetPageId);

      // Insert into indexes
      for (const col of tableInfo.columns) {
        const colName = col.name;
        if (catalog.hasIndex(ast.table, colName)) {
          const idx = catalog.getIndex(ast.table, colName);
          idx.insert(row[colName], { pageId: targetPageId, slotIndex });
        }
      }

      return { message: "1 row inserted." };
    }

    case 'SELECT': {
      const matches = planAndExecuteScan(catalog, bufferPool, ast.table, ast.where);
      
      return matches.map(match => {
        // Return full row objects if SELECT *
        if (ast.columns.length === 1 && ast.columns[0] === '*') {
          return match.row;
        }
        
        // Otherwise, project just the requested columns
        const projected = {};
        for (const col of ast.columns) {
          projected[col] = match.row[col];
        }
        return projected;
      });
    }

    case 'DELETE': {
      const matches = planAndExecuteScan(catalog, bufferPool, ast.table, ast.where);
      
      for (const match of matches) {
        const pageId = match.recordId.pageId;
        const slotIdx = match.recordId.slotIndex;
        
        // Physically delete from the page
        const page = bufferPool.getPage(pageId);
        page.deleteSlot(slotIdx);
        bufferPool.unpinPage(pageId);

        // Delete from indexes
        const tableInfo = catalog.getTable(ast.table);
        for (const col of tableInfo.columns) {
          const colName = col.name;
          if (catalog.hasIndex(ast.table, colName)) {
            const idx = catalog.getIndex(ast.table, colName);
            idx.delete(match.row[colName]);
          }
        }
      }

      return { message: `${matches.length} row(s) deleted.` };
    }

    default:
      throw new Error(`Unrecognized AST type for execution: ${ast.type}`);
  }
}


/**
 * Begins a transaction by appending a BEGIN entry to the WAL.
 *
 * @param {WAL} wal
 * @param {string|number} txnId
 */
function beginTransaction(wal, txnId) {
  wal.logBegin(txnId);
}

/**
 * Commits a transaction by appending a COMMIT entry to the WAL.
 *
 * @param {WAL} wal
 * @param {string|number} txnId
 */
function commitTransaction(wal, txnId) {
  wal.logCommit(txnId);
}

/**
 * Executes a parsed SQL AST and writes WAL log entries for every
 * data-modifying operation (INSERT / DELETE).
 *
 * Must be called between beginTransaction() and commitTransaction().
 *
 * @param {Object} ast
 * @param {Catalog} catalog
 * @param {BufferPool} bufferPool
 * @param {WAL} wal
 * @param {string|number} txnId
 * @returns {Object|Array}
 */
function executeWithWAL(ast, catalog, bufferPool, wal, txnId) {
  if (ast.type === 'INSERT') {
    const tableInfo = catalog.getTable(ast.table);

    // Build row object
    const row = {};
    for (let i = 0; i < tableInfo.columns.length; i++) {
      row[tableInfo.columns[i].name] = ast.values[i];
    }

    const rowData = JSON.stringify(row);
    const rowLen = Buffer.byteLength(rowData, 'utf8');

    let targetPage = null;
    let targetPageId = null;

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
      catalog.addPage(ast.table, targetPageId);
    }

    const slotIndex = targetPage.writeSlot(rowData);
    bufferPool.unpinPage(targetPageId);

    // Log BEFORE returning — WAL must be written before the operation is
    // considered complete (write-ahead guarantee).
    wal.logInsert(txnId, ast.table, row);

    // Update indexes
    for (const col of tableInfo.columns) {
      if (catalog.hasIndex(ast.table, col.name)) {
        catalog.getIndex(ast.table, col.name).insert(row[col.name], { pageId: targetPageId, slotIndex });
      }
    }

    return { message: '1 row inserted.' };
  }

  if (ast.type === 'DELETE') {
    const { planAndExecuteScan } = require('../sql/planner');
    const matches = planAndExecuteScan(catalog, bufferPool, ast.table, ast.where);

    for (const match of matches) {
      const { pageId, slotIndex } = match.recordId;

      // Log the delete before applying it
      wal.logDelete(txnId, ast.table, match.recordId, match.row);

      const page = bufferPool.getPage(pageId);
      page.deleteSlot(slotIndex);
      bufferPool.unpinPage(pageId);

      const tableInfo = catalog.getTable(ast.table);
      for (const col of tableInfo.columns) {
        if (catalog.hasIndex(ast.table, col.name)) {
          catalog.getIndex(ast.table, col.name).delete(match.row[col.name]);
        }
      }
    }

    return { message: `${matches.length} row(s) deleted.` };
  }

  // Non-mutating operations (SELECT, CREATE_TABLE) don't need WAL entries
  return execute(ast, catalog, bufferPool);
}


// ═══════════════════════════════════════════════════════════════════════
//  MVCC-aware executor (Week 6)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Executes a parsed SQL AST under MVCC rules.
 *
 * INSERT  – wraps the row with wrapRow(), logs the WRAPPED object to WAL,
 *           writes it to a page, and updates indexes.
 * SELECT  – uses planAndExecuteScanMVCC for visibility-filtered reads;
 *           projects columns the same way execute() does.
 * DELETE  – logical delete: tombstones the old slot, writes a new
 *           versioned row with deletedByTxn set, repoints indexes.
 *
 * @param {Object}             ast
 * @param {Catalog}            catalog
 * @param {BufferPool}         bufferPool
 * @param {WAL}                wal
 * @param {TransactionManager} txnManager
 * @param {number}             txnId
 * @returns {Object|Array}
 */
function executeWithMVCC(ast, catalog, bufferPool, wal, txnManager, txnId) {
  switch (ast.type) {
    // ── CREATE_TABLE ────────────────────────────────────────────────
    case 'CREATE_TABLE': {
      catalog.createTable(ast.table, ast.columns);
      return { message: 'Table created.' };
    }

    // ── INSERT ──────────────────────────────────────────────────────
    case 'INSERT': {
      const tableInfo = catalog.getTable(ast.table);

      // Build the inner row object (zip column names with values)
      const row = {};
      for (let i = 0; i < tableInfo.columns.length; i++) {
        row[tableInfo.columns[i].name] = ast.values[i];
      }

      // Wrap the row with MVCC version metadata
      const wrappedRow = wrapRow(row, txnId);

      // WAL — log the WRAPPED object before writing (write-ahead)
      wal.logInsert(txnId, ast.table, wrappedRow);

      const rowData = JSON.stringify(wrappedRow);
      const rowLen = Buffer.byteLength(rowData, 'utf8');

      let targetPage = null;
      let targetPageId = null;

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
        catalog.addPage(ast.table, targetPageId);
      }

      const slotIndex = targetPage.writeSlot(rowData);
      bufferPool.unpinPage(targetPageId);

      // Index keys are based on the INNER row's column values
      for (const col of tableInfo.columns) {
        if (catalog.hasIndex(ast.table, col.name)) {
          catalog.getIndex(ast.table, col.name)
            .insert(row[col.name], { pageId: targetPageId, slotIndex });
        }
      }

      return { message: '1 row inserted.' };
    }

    // ── SELECT ──────────────────────────────────────────────────────
    case 'SELECT': {
      const matches = planAndExecuteScanMVCC(
        catalog, bufferPool, ast.table, ast.where, txnId, txnManager
      );

      return matches.map(match => {
        // match.row is already the inner data object
        if (ast.columns.length === 1 && ast.columns[0] === '*') {
          return match.row;
        }
        const projected = {};
        for (const col of ast.columns) {
          projected[col] = match.row[col];
        }
        return projected;
      });
    }

    // ── DELETE (MVCC logical delete) ────────────────────────────────
    case 'DELETE': {
      const matches = planAndExecuteScanMVCC(
        catalog, bufferPool, ast.table, ast.where, txnId, txnManager
      );

      for (const match of matches) {
        // (a) Create a NEW version of the row with deletedByTxn set.
        //     Don't mutate the original in place.
        const updatedVersionedRow = {
          createdByTxn: match.versionedRow.createdByTxn,
          deletedByTxn: txnId,
          data: match.versionedRow.data,
        };

        // (b) Log the delete intent to WAL.
        //     We log the OLD recordId for audit purposes, even though
        //     MVCC delete doesn't actually reuse it — the new version
        //     gets a fresh slot.
        wal.logDelete(txnId, ast.table, match.recordId, match.row);

        // (c) Tombstone the OLD slot
        const oldPage = bufferPool.getPage(match.recordId.pageId);
        oldPage.deleteSlot(match.recordId.slotIndex);
        bufferPool.unpinPage(match.recordId.pageId);

        // Write the NEW versioned row (with deletedByTxn set) to get
        // a new recordId
        const newRowData = JSON.stringify(updatedVersionedRow);
        const newRowLen = Buffer.byteLength(newRowData, 'utf8');

        const tableInfo = catalog.getTable(ast.table);
        let newPage = null;
        let newPageId = null;

        for (const pid of tableInfo.pageIds) {
          const page = bufferPool.getPage(pid);
          if (page.hasSpaceFor(newRowLen)) {
            newPage = page;
            newPageId = pid;
            break;
          } else {
            bufferPool.unpinPage(pid);
          }
        }

        if (!newPage) {
          newPage = bufferPool.newPage();
          newPageId = newPage.pageId;
          catalog.addPage(ast.table, newPageId);
        }

        const newSlotIndex = newPage.writeSlot(newRowData);
        bufferPool.unpinPage(newPageId);

        const newRecordId = { pageId: newPageId, slotIndex: newSlotIndex };

        // (d) Repoint indexes at the new physical location.
        //     index.insert() already overwrites existing keys (built in
        //     Week 2), so this correctly updates the pointer.
        for (const col of tableInfo.columns) {
          if (catalog.hasIndex(ast.table, col.name)) {
            catalog.getIndex(ast.table, col.name)
              .insert(match.row[col.name], newRecordId);
          }
        }
      }

      return { message: `${matches.length} row(s) marked deleted.` };
    }

    default:
      throw new Error(`Unrecognized AST type for MVCC execution: ${ast.type}`);
  }
}

/**
 * Begins a new MVCC transaction.
 *
 * @param {WAL}                wal
 * @param {TransactionManager} txnManager
 * @returns {number} The new txnId
 */
function beginMVCCTransaction(wal, txnManager) {
  const txnId = txnManager.begin();
  wal.logBegin(txnId);
  return txnId;
}

/**
 * Commits an MVCC transaction.
 *
 * @param {WAL}                wal
 * @param {TransactionManager} txnManager
 * @param {number}             txnId
 */
function commitMVCCTransaction(wal, txnManager, txnId) {
  txnManager.commit(txnId);
  wal.logCommit(txnId);
}

/**
 * Rolls back an MVCC transaction.
 *
 * No data needs to be physically undone here — MVCC visibility rules
 * already make an aborted transaction's writes permanently invisible
 * to everyone.  isVisible() checks isCommitted(), which permanently
 * returns false for aborted txnIds.  This is the payoff of the whole
 * MVCC design: rollback is essentially free.
 *
 * @param {WAL}                wal
 * @param {TransactionManager} txnManager
 * @param {number}             txnId
 */
function rollbackMVCCTransaction(wal, txnManager, txnId) {
  txnManager.abort(txnId);
  wal.logAbort(txnId);
}

module.exports = {
  execute,
  beginTransaction,
  commitTransaction,
  executeWithWAL,
  executeWithMVCC,
  beginMVCCTransaction,
  commitMVCCTransaction,
  rollbackMVCCTransaction,
};
