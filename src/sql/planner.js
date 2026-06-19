const { seqScan, seqScanMVCC } = require('../executor/seq-scan');
const { indexScan, indexScanMVCC } = require('../executor/index-scan');
const { evaluateCondition } = require('../executor/eval-condition');

/**
 * Decides whether to use an index scan or a sequential scan based on
 * the AST's WHERE condition, then executes the chosen plan.
 * 
 * @param {Catalog} catalog
 * @param {BufferPool} bufferPool
 * @param {string} tableName
 * @param {Object} whereAst
 * @returns {Array<{ recordId: { pageId, slotIndex }, row }>}
 */
function planAndExecuteScan(catalog, bufferPool, tableName, whereAst) {
  if (!whereAst) {
    console.log('[planner] Using sequential scan');
    return seqScan(catalog, bufferPool, tableName, whereAst);
  }

  // Pure COMPARISON check
  if (whereAst.type === 'COMPARISON' && catalog.hasIndex(tableName, whereAst.left)) {
    console.log(`[planner] Using index scan on column '${whereAst.left}'`);
    return indexScan(catalog, bufferPool, tableName, whereAst.left, whereAst);
  }

  // LOGICAL AND check
  if (whereAst.type === 'LOGICAL' && whereAst.op === 'AND') {
    let indexCol = null;
    let indexAst = null;
    
    // Check if the left side of the AND is an indexed comparison
    if (whereAst.left.type === 'COMPARISON' && catalog.hasIndex(tableName, whereAst.left.left)) {
      indexCol = whereAst.left.left;
      indexAst = whereAst.left;
    } 
    // Check if the right side of the AND is an indexed comparison
    else if (whereAst.right.type === 'COMPARISON' && catalog.hasIndex(tableName, whereAst.right.left)) {
      indexCol = whereAst.right.left;
      indexAst = whereAst.right;
    }

    if (indexCol) {
      console.log(`[planner] Using index scan on column '${indexCol}' with post-filter`);
      
      // Use the index scan to fetch a narrow set of candidates
      const candidates = indexScan(catalog, bufferPool, tableName, indexCol, indexAst);
      
      // Apply evaluateCondition with the FULL whereAst as a post-filter
      return candidates.filter(cand => evaluateCondition(whereAst, cand.row));
    }
  }

  // Fallback if no relevant indexes are found
  console.log('[planner] Using sequential scan');
  return seqScan(catalog, bufferPool, tableName, whereAst);
}

/**
 * MVCC-aware version of planAndExecuteScan.
 *
 * Same index-vs-seqscan decision logic, but routes to seqScanMVCC /
 * indexScanMVCC so that only rows visible to `currentTxnId` are returned.
 *
 * @param {Catalog}            catalog
 * @param {BufferPool}         bufferPool
 * @param {string}             tableName
 * @param {Object}             whereAst
 * @param {number}             currentTxnId
 * @param {TransactionManager} txnManager
 * @returns {Array<{ recordId, row, versionedRow }>}
 */
function planAndExecuteScanMVCC(catalog, bufferPool, tableName, whereAst, currentTxnId, txnManager) {
  if (!whereAst) {
    console.log('[planner] Using sequential scan (MVCC)');
    return seqScanMVCC(catalog, bufferPool, tableName, whereAst, currentTxnId, txnManager);
  }

  // Pure COMPARISON check
  if (whereAst.type === 'COMPARISON' && catalog.hasIndex(tableName, whereAst.left)) {
    console.log(`[planner] Using index scan on column '${whereAst.left}' (MVCC)`);
    return indexScanMVCC(catalog, bufferPool, tableName, whereAst.left, whereAst, currentTxnId, txnManager);
  }

  // LOGICAL AND check
  if (whereAst.type === 'LOGICAL' && whereAst.op === 'AND') {
    let indexCol = null;
    let indexAst = null;

    if (whereAst.left.type === 'COMPARISON' && catalog.hasIndex(tableName, whereAst.left.left)) {
      indexCol = whereAst.left.left;
      indexAst = whereAst.left;
    }
    else if (whereAst.right.type === 'COMPARISON' && catalog.hasIndex(tableName, whereAst.right.left)) {
      indexCol = whereAst.right.left;
      indexAst = whereAst.right;
    }

    if (indexCol) {
      console.log(`[planner] Using index scan on column '${indexCol}' with post-filter (MVCC)`);
      const candidates = indexScanMVCC(catalog, bufferPool, tableName, indexCol, indexAst, currentTxnId, txnManager);
      return candidates.filter(cand => evaluateCondition(whereAst, cand.row));
    }
  }

  // Fallback
  console.log('[planner] Using sequential scan (MVCC)');
  return seqScanMVCC(catalog, bufferPool, tableName, whereAst, currentTxnId, txnManager);
}

module.exports = { planAndExecuteScan, planAndExecuteScanMVCC };
