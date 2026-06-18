const { planAndExecuteScan } = require('../sql/planner');

/**
 * Executes a parsed SQL AST.
 * 
 * @param {Object} ast - The parsed SQL query
 * @param {Catalog} catalog
 * @param {BufferPool} bufferPool
 * @returns {Object|Array} Result of execution
 */
function execute(ast, catalog, bufferPool) {
  switch (ast.type) {
    case 'CREATE_TABLE': {
      catalog.createTable(ast.table, ast.columns);
      return { message: "Table created." };
    }

    case 'INSERT': {
      const tableInfo = catalog.getTable(ast.table);
      
      // Build row object by zipping column names with values
      const row = {};
      for (let i = 0; i < tableInfo.columns.length; i++) {
        row[tableInfo.columns[i].name] = ast.values[i];
      }
      
      const rowData = JSON.stringify(row);
      const rowLen = Buffer.byteLength(rowData, 'utf8');

      let targetPage = null;
      let targetPageId = null;

      // Find a page with room
      for (const pid of tableInfo.pageIds) {
        const page = bufferPool.getPage(pid);
        if (page.hasSpaceFor(rowLen)) {
          targetPage = page;
          targetPageId = pid;
          break;
        } else {
          bufferPool.unpinPage(pid); // Was not used, unpin immediately
        }
      }

      // If no page found or table is empty, create a new one
      if (!targetPage) {
        targetPage = bufferPool.newPage();
        targetPageId = targetPage.pageId;
        catalog.addPage(ast.table, targetPageId);
      }

      const slotIndex = targetPage.writeSlot(rowData);
      
      // We must unpin the target page when done writing
      bufferPool.unpinPage(targetPageId);

      // Insert into indexes
      for (const col of tableInfo.columns) {
        const colName = col.name;
        if (catalog.hasIndex(ast.table, colName)) {
          const idx = catalog.getIndex(ast.table, colName);
          idx.insert(row[colName], { pageId: targetPageId, slotIndex });
        }
      }

      return { message: "1 row inserted." };
    }

    case 'SELECT': {
      const matches = planAndExecuteScan(catalog, bufferPool, ast.table, ast.where);
      
      return matches.map(match => {
        // Return full row objects if SELECT *
        if (ast.columns.length === 1 && ast.columns[0] === '*') {
          return match.row;
        }
        
        // Otherwise, project just the requested columns
        const projected = {};
        for (const col of ast.columns) {
          projected[col] = match.row[col];
        }
        return projected;
      });
    }

    case 'DELETE': {
      const matches = planAndExecuteScan(catalog, bufferPool, ast.table, ast.where);
      
      for (const match of matches) {
        const pageId = match.recordId.pageId;
        const slotIdx = match.recordId.slotIndex;
        
        // Physically delete from the page
        const page = bufferPool.getPage(pageId);
        page.deleteSlot(slotIdx);
        bufferPool.unpinPage(pageId);

        // Delete from indexes
        const tableInfo = catalog.getTable(ast.table);
        for (const col of tableInfo.columns) {
          const colName = col.name;
          if (catalog.hasIndex(ast.table, colName)) {
            const idx = catalog.getIndex(ast.table, colName);
            idx.delete(match.row[colName]);
          }
        }
      }

      return { message: `${matches.length} row(s) deleted.` };
    }

    default:
      throw new Error(`Unrecognized AST type for execution: ${ast.type}`);
  }
}

module.exports = { execute };
