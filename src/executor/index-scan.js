/**
 * Performs an index scan over a table's column index.
 * 
 * @param {Catalog} catalog
 * @param {BufferPool} bufferPool
 * @param {string} tableName
 * @param {string} columnName
 * @param {Object} conditionAst - Expected to be a COMPARISON ast node for this column
 * @returns {Array<{ recordId: { pageId, slotIndex }, row }>}
 */
function indexScan(catalog, bufferPool, tableName, columnName, conditionAst) {
  const index = catalog.getIndex(tableName, columnName);
  if (!index) {
    throw new Error(`Index does not exist on ${tableName}.${columnName}`);
  }

  // We need conditionAst to be a valid COMPARISON on the indexed column
  if (!conditionAst || conditionAst.type !== 'COMPARISON' || conditionAst.left !== columnName) {
    throw new Error('indexScan requires a COMPARISON condition on the indexed column');
  }

  const results = [];
  const op = conditionAst.op;
  const rightVal = conditionAst.right;

  // Helper to fetch the actual row data via its recordId
  const resolveRecord = (recordId) => {
    const page = bufferPool.getPage(recordId.pageId);
    const data = page.readSlot(recordId.slotIndex);
    if (data === null) {
      bufferPool.unpinPage(recordId.pageId);
      return null;
    }
    const row = JSON.parse(data.toString('utf-8'));
    bufferPool.unpinPage(recordId.pageId);
    return { recordId, row };
  };

  if (op === '=' || op === 'EQ') {
    const recordId = index.search(rightVal);
    if (recordId) {
      const resolved = resolveRecord(recordId);
      if (resolved) results.push(resolved);
    }
  } else if (op === '>' || op === 'GT' || op === '>=' || op === 'GTE') {
    // Note: rangeSearch is inclusive on both ends.
    // For strict ">" we must filter out rows where the key exactly matches conditionAst.right.
    const indexResults = index.rangeSearch(rightVal, Infinity);
    for (const res of indexResults) {
      if ((op === '>' || op === 'GT') && res.key === rightVal) {
        continue; // Skip exact match for strict greater-than
      }
      const resolved = resolveRecord(res.recordId);
      if (resolved) results.push(resolved);
    }
  } else if (op === '<' || op === 'LT' || op === '<=' || op === 'LTE') {
    // Note: rangeSearch(-Infinity, conditionAst.right)
    // For strict "<" we must filter out the exact boundary.
    const indexResults = index.rangeSearch(-Infinity, rightVal);
    for (const res of indexResults) {
      if ((op === '<' || op === 'LT') && res.key === rightVal) {
        continue; // Skip exact match for strict less-than
      }
      const resolved = resolveRecord(res.recordId);
      if (resolved) results.push(resolved);
    }
  } else {
    throw new Error(`Unsupported operator for index scan: ${op}`);
  }

  return results;
}

module.exports = { indexScan };
