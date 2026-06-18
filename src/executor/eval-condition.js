/**
 * Evaluates a condition AST node against a row.
 * Returns true if the row matches, false otherwise.
 * If conditionAst is null/undefined, returns true.
 *
 * @param {Object} conditionAst 
 * @param {Object} row 
 * @returns {boolean}
 */
function evaluateCondition(conditionAst, row) {
  if (!conditionAst) {
    return true; // No filter = match everything
  }

  if (conditionAst.type === 'COMPARISON') {
    const leftVal = row[conditionAst.left];
    const rightVal = conditionAst.right;
    
    switch (conditionAst.op) {
      case '=':
      case 'EQ':
        return leftVal === rightVal;
      case '>':
      case 'GT':
        return leftVal > rightVal;
      case '<':
      case 'LT':
        return leftVal < rightVal;
      case '>=':
      case 'GTE':
        return leftVal >= rightVal;
      case '<=':
      case 'LTE':
        return leftVal <= rightVal;
      case '!=':
      case '<>':
      case 'NEQ':
        return leftVal !== rightVal;
      default:
        throw new Error(`Unknown comparison operator: ${conditionAst.op}`);
    }
  }

  if (conditionAst.type === 'LOGICAL') {
    const leftMatch = evaluateCondition(conditionAst.left, row);
    if (conditionAst.op === 'AND') {
      if (!leftMatch) return false;
      return evaluateCondition(conditionAst.right, row);
    } else if (conditionAst.op === 'OR') {
      if (leftMatch) return true;
      return evaluateCondition(conditionAst.right, row);
    } else {
      throw new Error(`Unknown logical operator: ${conditionAst.op}`);
    }
  }

  throw new Error(`Unknown condition AST type: ${conditionAst.type}`);
}

module.exports = { evaluateCondition };
