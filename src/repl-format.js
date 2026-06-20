function formatRowsAsTable(rows) {
  if (!rows || rows.length === 0) {
    return "(0 rows)";
  }

  const columns = Object.keys(rows[0]);
  const colWidths = {};

  // Compute widths
  for (const col of columns) {
    let maxLen = col.length;
    for (const row of rows) {
      const valStr = String(row[col]);
      if (valStr.length > maxLen) {
        maxLen = valStr.length;
      }
    }
    colWidths[col] = maxLen;
  }

  // Box drawing characters
  const TOP_LEFT = '┌';
  const TOP_MID = '┬';
  const TOP_RIGHT = '┐';
  const MID_LEFT = '├';
  const MID_MID = '┼';
  const MID_RIGHT = '┤';
  const BOT_LEFT = '└';
  const BOT_MID = '┴';
  const BOT_RIGHT = '┘';
  const H_LINE = '─';
  const V_LINE = '│';

  function centerText(text, width) {
    const spaces = width - text.length;
    const leftPad = Math.floor(spaces / 2);
    const rightPad = spaces - leftPad;
    return ' '.repeat(leftPad) + text + ' '.repeat(rightPad);
  }

  function buildLine(left, mid, right, fillChar) {
    let line = left;
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      // +2 for the single space padding on each side
      line += fillChar.repeat(colWidths[col] + 2);
      if (i < columns.length - 1) {
        line += mid;
      }
    }
    line += right;
    return line;
  }

  const lines = [];

  // Top border
  lines.push(buildLine(TOP_LEFT, TOP_MID, TOP_RIGHT, H_LINE));

  // Headers
  let headerRow = V_LINE;
  for (const col of columns) {
    headerRow += ' ' + centerText(col, colWidths[col]) + ' ' + V_LINE;
  }
  lines.push(headerRow);

  // Separator
  lines.push(buildLine(MID_LEFT, MID_MID, MID_RIGHT, H_LINE));

  // Rows
  for (const row of rows) {
    let dataRow = V_LINE;
    for (const col of columns) {
      const valStr = String(row[col]);
      dataRow += ' ' + centerText(valStr, colWidths[col]) + ' ' + V_LINE;
    }
    lines.push(dataRow);
  }

  // Bottom border
  lines.push(buildLine(BOT_LEFT, BOT_MID, BOT_RIGHT, H_LINE));
  
  // Footer text
  lines.push(`(${rows.length} row${rows.length === 1 ? '' : 's'})`);

  return lines.join('\n');
}

module.exports = { formatRowsAsTable };
