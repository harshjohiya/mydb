/**
 * SQL Lexer (Tokenizer)
 * 
 * Example usage:
 * tokenize("SELECT name FROM users WHERE age > 25")
 * 
 * Expected output:
 * [
 *   { type: 'SELECT', value: 'SELECT' },
 *   { type: 'IDENTIFIER', value: 'name' },
 *   { type: 'FROM', value: 'FROM' },
 *   { type: 'IDENTIFIER', value: 'users' },
 *   { type: 'WHERE', value: 'WHERE' },
 *   { type: 'IDENTIFIER', value: 'age' },
 *   { type: 'GT', value: '>' },
 *   { type: 'NUMBER', value: '25' },
 *   { type: 'EOF', value: 'EOF' }
 * ]
 */

const KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES',
  'CREATE', 'TABLE', 'DELETE', 'AND', 'OR'
]);

function tokenize(sql) {
  const tokens = [];
  let i = 0;

  while (i < sql.length) {
    let char = sql[i];

    // 1. Skip whitespace
    if (/\s/.test(char)) {
      i++;
      continue;
    }

    // 2. Strings (single-quoted)
    if (char === "'") {
      let value = '';
      i++; // skip opening quote
      while (i < sql.length && sql[i] !== "'") {
        value += sql[i];
        i++;
      }
      if (i >= sql.length) {
        throw new Error(`Unterminated string starting at position ${i - value.length - 1}`);
      }
      i++; // skip closing quote
      tokens.push({ type: 'STRING', value });
      continue;
    }

    // 3. Numbers (integers only)
    if (/[0-9]/.test(char)) {
      let value = '';
      while (i < sql.length && /[0-9]/.test(sql[i])) {
        value += sql[i];
        i++;
      }
      tokens.push({ type: 'NUMBER', value });
      continue;
    }

    // 4. Identifiers and Keywords
    if (/[a-zA-Z_]/.test(char)) {
      let value = '';
      while (i < sql.length && /[a-zA-Z0-9_]/.test(sql[i])) {
        value += sql[i];
        i++;
      }
      
      const upperValue = value.toUpperCase();
      if (KEYWORDS.has(upperValue)) {
        tokens.push({ type: upperValue, value: upperValue });
      } else {
        tokens.push({ type: 'IDENTIFIER', value });
      }
      continue;
    }

    // 5. Multi-character operators
    if (i + 1 < sql.length) {
      const twoChars = sql.substring(i, i + 2);
      let matched = true;
      if (twoChars === '>=') tokens.push({ type: 'GTE', value: '>=' });
      else if (twoChars === '<=') tokens.push({ type: 'LTE', value: '<=' });
      else if (twoChars === '!=') tokens.push({ type: 'NEQ', value: '!=' });
      else if (twoChars === '<>') tokens.push({ type: 'NEQ', value: '<>' }); // <> is alias for !=
      else matched = false;

      if (matched) {
        i += 2;
        continue;
      }
    }

    // 6. Single-character punctuation/operators
    let matched = true;
    if (char === ',') tokens.push({ type: 'COMMA', value: ',' });
    else if (char === '*') tokens.push({ type: 'STAR', value: '*' });
    else if (char === '(') tokens.push({ type: 'LPAREN', value: '(' });
    else if (char === ')') tokens.push({ type: 'RPAREN', value: ')' });
    else if (char === ';') tokens.push({ type: 'SEMICOLON', value: ';' });
    else if (char === '=') tokens.push({ type: 'EQ', value: '=' });
    else if (char === '>') tokens.push({ type: 'GT', value: '>' });
    else if (char === '<') tokens.push({ type: 'LT', value: '<' });
    else matched = false;

    if (matched) {
      i++;
      continue;
    }

    // 7. Unrecognized character
    throw new Error(`Unexpected character '${char}' at position ${i}`);
  }

  tokens.push({ type: 'EOF', value: 'EOF' });
  return tokens;
}

module.exports = { tokenize };
