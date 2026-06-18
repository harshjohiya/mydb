const { evaluateCondition } = require('./eval-condition');

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

module.exports = { seqScan };
