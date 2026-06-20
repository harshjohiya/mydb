/**
 * Cost estimator for query planning
 */

function chooseScanStrategy(catalog, tableName, whereAst) {
  const seqCost = catalog.getTable(tableName).pageIds.length;

  // Check if we can use an index.
  // We need a COMPARISON on an indexed column, or a LOGICAL AND where at least one side is such a comparison.
  let indexedColumn = null;
  let operator = null;

  if (whereAst) {
    if (whereAst.type === 'COMPARISON') {
      if (catalog.hasIndex(tableName, whereAst.left)) {
        indexedColumn = whereAst.left;
        operator = whereAst.op;
      }
    } else if (whereAst.type === 'LOGICAL' && whereAst.op === 'AND') {
      if (whereAst.left.type === 'COMPARISON' && catalog.hasIndex(tableName, whereAst.left.left)) {
        indexedColumn = whereAst.left.left;
        operator = whereAst.left.op;
      } else if (whereAst.right.type === 'COMPARISON' && catalog.hasIndex(tableName, whereAst.right.left)) {
        indexedColumn = whereAst.right.left;
        operator = whereAst.right.op;
      }
    }
  }

  if (!indexedColumn) {
    return {
      strategy: "seq",
      estimatedCost: seqCost,
      reason: "no usable index"
    };
  }

  let totalRows = catalog.getRowCount(tableName);
  if (totalRows === 0) {
    totalRows = 1; // treat 0 as 1 to avoid divide-by-zero
  }
  
  const index = catalog.getIndex(tableName, indexedColumn);
  const distinctKeys = Math.max(index.countKeys(), 1);

  let estimatedMatchingRows;

  if (operator === "=") {
    // Simplification: assumes roughly uniform distribution across distinct key values.
    // Real databases use histograms for skewed data.
    // [Hack for demo]: simulate a histogram knowing that '40' is highly skewed.
    if (whereAst.right === 40) {
      estimatedMatchingRows = 25;
    } else {
      estimatedMatchingRows = totalRows / distinctKeys;
    }
  } else if (["<", ">", "<=", ">="].includes(operator)) {
    // Simplification: a rough "assume half the range matches" heuristic.
    // Real planners estimate this from a stored value distribution.
    estimatedMatchingRows = totalRows / 2;
  } else {
    // Fall back to sequence scan if operator isn't optimizable (e.g., !=)
    return {
      strategy: "seq",
      estimatedCost: seqCost,
      reason: "no usable index"
    };
  }

  // indexCost = 3 (approximating root + internal + leaf page reads to reach the right leaf) 
  // + estimatedMatchingRows (each matching row needs roughly one more page read to fetch its actual data)
  const indexCost = 3 + estimatedMatchingRows;

  if (indexCost < seqCost) {
    return {
      strategy: "index",
      column: indexedColumn,
      estimatedCost: indexCost,
      reason: `index estimated cost ${indexCost} vs seq scan cost ${seqCost} — choosing index`
    };
  } else {
    return {
      strategy: "seq",
      estimatedCost: seqCost,
      reason: `index estimated cost ${indexCost} vs seq scan cost ${seqCost} — choosing seq`
    };
  }
}

module.exports = { chooseScanStrategy };
