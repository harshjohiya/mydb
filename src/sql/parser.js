/**
 * SQL Parser
 *
 * Converts a token array into an Abstract Syntax Tree (AST).
 *
 * Example usage:
 * const tokens = tokenize("SELECT name FROM users WHERE age > 25");
 * const parser = new Parser(tokens);
 * const ast = parser.parse();
 *
 * Expected output:
 * {
 *   type: "SELECT",
 *   columns: ["name"],
 *   table: "users",
 *   where: {
 *     type: "COMPARISON",
 *     left: "age",
 *     op: ">",
 *     right: 25
 *   }
 * }
 */

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek() {
    return this.tokens[this.pos];
  }

  advance() {
    return this.tokens[this.pos++];
  }

  expect(type) {
    const token = this.peek();
    if (token.type !== type) {
      throw new Error(`Expected ${type} but got ${token.type} at token ${this.pos}`);
    }
    return this.advance();
  }

  parse() {
    const token = this.peek();
    switch (token.type) {
      case 'SELECT':
        return this.parseSelect();
      case 'INSERT':
        return this.parseInsert();
      case 'CREATE':
        return this.parseCreateTable();
      case 'DELETE':
        return this.parseDelete();
      default:
        throw new Error(`Unexpected token starting statement: ${token.type}`);
    }
  }

  // 1. SELECT col1, col2 FROM table [WHERE condition]
  parseSelect() {
    this.expect('SELECT');
    
    const columns = [];
    if (this.peek().type === 'STAR') {
      this.advance();
      columns.push('*');
    } else {
      columns.push(this.expect('IDENTIFIER').value);
      while (this.peek().type === 'COMMA') {
        this.advance();
        columns.push(this.expect('IDENTIFIER').value);
      }
    }

    this.expect('FROM');
    const table = this.expect('IDENTIFIER').value;

    let where = null;
    if (this.peek().type === 'WHERE') {
      this.advance();
      where = this.parseCondition();
    }

    return { type: 'SELECT', columns, table, where };
  }

  // 2. INSERT INTO table VALUES (val1, val2, ...)
  parseInsert() {
    this.expect('INSERT');
    this.expect('INTO');
    const table = this.expect('IDENTIFIER').value;
    
    this.expect('VALUES');
    this.expect('LPAREN');
    
    const values = [];
    let token = this.peek();
    while (token.type !== 'RPAREN') {
      if (token.type === 'NUMBER') {
        values.push(parseInt(this.advance().value, 10));
      } else if (token.type === 'STRING') {
        values.push(this.advance().value);
      } else {
        throw new Error(`Expected NUMBER or STRING in VALUES, got ${token.type}`);
      }
      
      if (this.peek().type === 'COMMA') {
        this.advance();
      }
      token = this.peek();
    }
    this.expect('RPAREN');

    return { type: 'INSERT', table, values };
  }

  // 3. CREATE TABLE table (col1 INT, col2 VARCHAR(255), ...)
  parseCreateTable() {
    this.expect('CREATE');
    this.expect('TABLE');
    const table = this.expect('IDENTIFIER').value;
    
    this.expect('LPAREN');
    
    const columns = [];
    let token = this.peek();
    while (token.type !== 'RPAREN') {
      const name = this.expect('IDENTIFIER').value;
      const dataType = this.expect('IDENTIFIER').value.toUpperCase(); // e.g., INT or VARCHAR
      
      let colDef = { name, dataType };
      
      // Capture length for types like VARCHAR(255)
      if (this.peek().type === 'LPAREN') {
        this.advance();
        colDef.length = parseInt(this.expect('NUMBER').value, 10);
        this.expect('RPAREN');
      }
      
      columns.push(colDef);
      
      if (this.peek().type === 'COMMA') {
        this.advance();
      }
      token = this.peek();
    }
    this.expect('RPAREN');

    return { type: 'CREATE_TABLE', table, columns };
  }

  // 4. DELETE FROM table [WHERE condition]
  parseDelete() {
    this.expect('DELETE');
    this.expect('FROM');
    const table = this.expect('IDENTIFIER').value;
    
    let where = null;
    if (this.peek().type === 'WHERE') {
      this.advance();
      where = this.parseCondition();
    }

    return { type: 'DELETE', table, where };
  }

  // Parse a single comparison, or two chained by AND/OR
  parseCondition() {
    const leftNode = this.parseSingleComparison();
    
    if (this.peek().type === 'AND' || this.peek().type === 'OR') {
      const op = this.advance().value.toUpperCase();
      const rightNode = this.parseSingleComparison();
      return { type: 'LOGICAL', op, left: leftNode, right: rightNode };
    }
    
    return leftNode;
  }

  // Helper for: <identifier> <op> <value>
  parseSingleComparison() {
    const left = this.expect('IDENTIFIER').value;
    
    const opToken = this.advance();
    const validOps = ['EQ', 'GT', 'LT', 'GTE', 'LTE', 'NEQ'];
    if (!validOps.includes(opToken.type)) {
      throw new Error(`Expected comparison operator, got ${opToken.type}`);
    }
    const op = opToken.value;
    
    const rightToken = this.advance();
    let right;
    if (rightToken.type === 'NUMBER') {
      right = parseInt(rightToken.value, 10);
    } else if (rightToken.type === 'STRING') {
      right = rightToken.value;
    } else {
      throw new Error(`Expected NUMBER or STRING in comparison, got ${rightToken.type}`);
    }
    
    return { type: 'COMPARISON', left, op, right };
  }
}

module.exports = { Parser };
