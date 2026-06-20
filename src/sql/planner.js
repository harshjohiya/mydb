const { seqScan, seqScanMVCC } = require('../executor/seq-scan');
const { indexScan, indexScanMVCC } = require('../executor/index-scan');
const { evaluateCondition } = require('../executor/eval-condition');
const { chooseScanStrategy } = require('./cost-estimator');

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
  const decision = chooseScanStrategy(catalog, tableName, whereAst);
  console.log(`[planner] ${decision.reason}`);

  if (decision.strategy === 'index') {
    if (whereAst.type === 'COMPARISON') {
      return indexScan(catalog, bufferPool, tableName, decision.column, whereAst);
    }
    
    if (whereAst.type === 'LOGICAL' && whereAst.op === 'AND') {
      let indexAst = null;
      if (whereAst.left.type === 'COMPARISON' && whereAst.left.left === decision.column) {
        indexAst = whereAst.left;
      } else if (whereAst.right.type === 'COMPARISON' && whereAst.right.left === decision.column) {
        indexAst = whereAst.right;
      }

      if (indexAst) {
        const candidates = indexScan(catalog, bufferPool, tableName, decision.column, indexAst);
        return candidates.filter(cand => evaluateCondition(whereAst, cand.row));
      }
    }
  }

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
  const decision = chooseScanStrategy(catalog, tableName, whereAst);
  console.log(`[planner] ${decision.reason} (MVCC)`);

  if (decision.strategy === 'index') {
    if (whereAst.type === 'COMPARISON') {
      return indexScanMVCC(catalog, bufferPool, tableName, decision.column, whereAst, currentTxnId, txnManager);
    }
    
    if (whereAst.type === 'LOGICAL' && whereAst.op === 'AND') {
      let indexAst = null;
      if (whereAst.left.type === 'COMPARISON' && whereAst.left.left === decision.column) {
        indexAst = whereAst.left;
      } else if (whereAst.right.type === 'COMPARISON' && whereAst.right.left === decision.column) {
        indexAst = whereAst.right;
      }

      if (indexAst) {
        const candidates = indexScanMVCC(catalog, bufferPool, tableName, decision.column, indexAst, currentTxnId, txnManager);
        return candidates.filter(cand => evaluateCondition(whereAst, cand.row));
      }
    }
  }

  return seqScanMVCC(catalog, bufferPool, tableName, whereAst, currentTxnId, txnManager);
}

module.exports = { planAndExecuteScan, planAndExecuteScanMVCC };
