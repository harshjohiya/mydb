const assert = require('assert');
const { tokenize } = require('../src/sql/lexer');
const { Parser } = require('../src/sql/parser');

// ---------------------------------------------------------------------------
// Lexer Tests
// ---------------------------------------------------------------------------

function testTokenizeSimpleSelect() {
  const tokens = tokenize("SELECT name FROM users");
  const types = tokens.map(t => t.type);
  assert.deepStrictEqual(types, ['SELECT', 'IDENTIFIER', 'FROM', 'IDENTIFIER', 'EOF']);
  console.log('✓ testTokenizeSimpleSelect passed');
}

function testTokenizeWithWhereClause() {
  const tokens = tokenize("SELECT * FROM users WHERE age > 25");
  const types = tokens.map(t => t.type);
  assert.ok(types.includes('STAR'), 'Must produce STAR token');
  assert.ok(types.includes('GT'), 'Must produce GT token');
  const numToken = tokens.find(t => t.type === 'NUMBER');
  assert.strictEqual(numToken.value, '25');
  console.log('✓ testTokenizeWithWhereClause passed');
}

function testTokenizeString() {
  const tokens = tokenize("INSERT INTO users VALUES (1, 'Rahul')");
  const strToken = tokens.find(t => t.type === 'STRING');
  assert.ok(strToken, 'Must produce a STRING token');
  assert.strictEqual(strToken.value, 'Rahul');
  console.log('✓ testTokenizeString passed');
}

function testTokenizeThrowsOnUnknownChar() {
  assert.throws(() => {
    tokenize("SELECT @ FROM users");
  }, /Unexpected character/);
  console.log('✓ testTokenizeThrowsOnUnknownChar passed');
}

// ---------------------------------------------------------------------------
// Parser Tests
// ---------------------------------------------------------------------------

function testParseSelectStar() {
  const tokens = tokenize("SELECT * FROM users");
  const parser = new Parser(tokens);
  const ast = parser.parse();
  
  assert.strictEqual(ast.type, 'SELECT');
  assert.deepStrictEqual(ast.columns, ['*']);
  assert.strictEqual(ast.table, 'users');
  assert.strictEqual(ast.where, null);
  console.log('✓ testParseSelectStar passed');
}

function testParseSelectWithWhere() {
  const tokens = tokenize("SELECT name FROM users WHERE age > 25");
  const parser = new Parser(tokens);
  const ast = parser.parse();
  
  assert.strictEqual(ast.type, 'SELECT');
  assert.strictEqual(ast.where.type, 'COMPARISON');
  assert.strictEqual(ast.where.left, 'age');
  assert.strictEqual(ast.where.op, '>');
  assert.strictEqual(ast.where.right, 25);
  console.log('✓ testParseSelectWithWhere passed');
}

function testParseInsert() {
  const tokens = tokenize("INSERT INTO users VALUES (1, 'Rahul', 22)");
  const parser = new Parser(tokens);
  const ast = parser.parse();
  
  assert.strictEqual(ast.type, 'INSERT');
  assert.strictEqual(ast.table, 'users');
  assert.deepStrictEqual(ast.values, [1, 'Rahul', 22]);
  console.log('✓ testParseInsert passed');
}

function testParseCreateTable() {
  const tokens = tokenize("CREATE TABLE users (id INT, name VARCHAR(100))");
  const parser = new Parser(tokens);
  const ast = parser.parse();
  
  assert.strictEqual(ast.type, 'CREATE_TABLE');
  assert.strictEqual(ast.table, 'users');
  assert.strictEqual(ast.columns.length, 2);
  
  assert.strictEqual(ast.columns[0].name, 'id');
  assert.strictEqual(ast.columns[0].dataType, 'INT');
  
  assert.strictEqual(ast.columns[1].name, 'name');
  assert.strictEqual(ast.columns[1].dataType, 'VARCHAR');
  assert.strictEqual(ast.columns[1].length, 100);
  
  console.log('✓ testParseCreateTable passed');
}

function testParseDelete() {
  const tokens = tokenize("DELETE FROM users WHERE age > 25");
  const parser = new Parser(tokens);
  const ast = parser.parse();
  
  assert.strictEqual(ast.type, 'DELETE');
  assert.strictEqual(ast.table, 'users');
  assert.strictEqual(ast.where.type, 'COMPARISON');
  assert.strictEqual(ast.where.op, '>');
  console.log('✓ testParseDelete passed');
}

function testParseLogicalAnd() {
  const tokens = tokenize("SELECT * FROM users WHERE age > 18 AND age < 65");
  const parser = new Parser(tokens);
  const ast = parser.parse();
  
  assert.strictEqual(ast.where.type, 'LOGICAL');
  assert.strictEqual(ast.where.op, 'AND');
  assert.strictEqual(ast.where.left.type, 'COMPARISON');
  assert.strictEqual(ast.where.right.type, 'COMPARISON');
  console.log('✓ testParseLogicalAnd passed');
}

// ---------------------------------------------------------------------------
// Run all
// ---------------------------------------------------------------------------
function runAllTests() {
  console.log('Running Week 3 tests...');
  testTokenizeSimpleSelect();
  testTokenizeWithWhereClause();
  testTokenizeString();
  testTokenizeThrowsOnUnknownChar();
  
  testParseSelectStar();
  testParseSelectWithWhere();
  testParseInsert();
  testParseCreateTable();
  testParseDelete();
  testParseLogicalAnd();
  
  console.log('All Week 3 tests passed');
}

runAllTests();
