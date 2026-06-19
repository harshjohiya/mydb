const { evaluateCondition } = require('./eval-condition');
const { isVisible } = require('../transaction/mvcc');

/**
 * Performs a sequential scan over a table, filtering by an optional WHERE condition.
 * 
 * @param {Catalog} catalog
 * @param {BufferPool} bufferPool
 * @param {string} tableName
 * @param {Object} whereAst
 * @returns {Array<{ recordId: { pageId, slotIndex }, row }>}
 */
function seqScan(catalog, bufferPool, tableName, whereAst) {
  const tableInfo = catalog.getTable(tableName); // throws if missing
  const results = [];

  for (const pageId of tableInfo.pageIds) {
    const page = bufferPool.getPage(pageId);
    const slots = page.getAllSlots();

    for (const slot of slots) {
      const rowStr = slot.data.toString('utf-8');
      let row;
      try {
        row = JSON.parse(rowStr);
      } catch (err) {
        // Log/handle parsing error if needed; skipping invalid row
        continue;
      }

      if (evaluateCondition(whereAst, row)) {
        results.push({
          recordId: { pageId, slotIndex: slot.slotIndex },
          row
        });
      }
    }
    
    // Unpin page when done reading all slots from it
    bufferPool.unpinPage(pageId);
  }

  return results;
}

/**
 * MVCC-aware sequential scan.
 *
 * Same page-walking iteration as seqScan, but each slot is now expected
 * to hold a versioned row: { createdByTxn, deletedByTxn, data }.
 *
 * Only rows that pass the isVisible() check for `currentTxnId` are
 * considered; the WHERE condition is evaluated against the INNER row
 * (versionedRow.data), not the wrapper.
 *
 * @param {Catalog}            catalog
 * @param {BufferPool}         bufferPool
 * @param {string}             tableName
 * @param {Object}             whereAst
 * @param {number}             currentTxnId
 * @param {TransactionManager} txnManager
 * @returns {Array<{ recordId: { pageId, slotIndex }, row: Object, versionedRow: Object }>}
 */
function seqScanMVCC(catalog, bufferPool, tableName, whereAst, currentTxnId, txnManager) {
  const tableInfo = catalog.getTable(tableName);
  const results = [];

  for (const pageId of tableInfo.pageIds) {
    const page = bufferPool.getPage(pageId);
    const slots = page.getAllSlots();

    for (const slot of slots) {
      const rawStr = slot.data.toString('utf-8');
      let versionedRow;
      try {
        versionedRow = JSON.parse(rawStr);
      } catch (err) {
        continue;
      }

      // Visibility check — the heart of MVCC
      if (!isVisible(versionedRow, currentTxnId, txnManager)) {
        continue;
      }

      // WHERE is evaluated against the inner data, not the wrapper
      if (evaluateCondition(whereAst, versionedRow.data)) {
        results.push({
          recordId: { pageId, slotIndex: slot.slotIndex },
          row: versionedRow.data,
          versionedRow,
        });
      }
    }

    bufferPool.unpinPage(pageId);
  }

  return results;
}

module.exports = { seqScan, seqScanMVCC };
