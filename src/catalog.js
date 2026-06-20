/**
 * Catalog
 * 
 * Tracks table metadata in memory.
 * 
 * NOTE: A real database persists this to special "system pages" 
 * so it survives restarts. Our version doesn't persist the catalog yet, 
 * which is a good future exercise.
 */

const { BPlusTree } = require('./index/btree');

class Catalog {
  constructor() {
    // Maps tableName -> TableInfo object
    // TableInfo structure: { columns, pageIds: [], indexes: new Map() }
    this.tables = new Map();
  }

  createTable(tableName, columns) {
    if (this.tables.has(tableName)) {
      throw new Error(`Table '${tableName}' already exists`);
    }

    const tableInfo = {
      columns: columns,
      pageIds: [],
      indexes: new Map(), // Maps columnName -> BPlusTree instance
      rowCount: 0
    };

    this.tables.set(tableName, tableInfo);
  }

  getTable(tableName) {
    if (!this.tables.has(tableName)) {
      throw new Error(`Table '${tableName}' does not exist`);
    }
    return this.tables.get(tableName);
  }

  addPage(tableName, pageId) {
    const tableInfo = this.getTable(tableName);
    tableInfo.pageIds.push(pageId);
  }

  createIndex(tableName, columnName, order = 4) {
    const tableInfo = this.getTable(tableName);
    const indexTree = new BPlusTree(order);
    tableInfo.indexes.set(columnName, indexTree);
    return indexTree;
  }

  getIndex(tableName, columnName) {
    const tableInfo = this.getTable(tableName);
    return tableInfo.indexes.get(columnName);
  }

  hasIndex(tableName, columnName) {
    const tableInfo = this.getTable(tableName);
    return tableInfo.indexes.has(columnName);
  }

  // A real database periodically runs ANALYZE to recompute statistics 
  // like this from scratch (since counters can drift from bugs, crashes, etc.).
  // Our version trusts the live counter, which is a simplification.
  incrementRowCount(tableName) {
    this.getTable(tableName).rowCount++;
  }

  decrementRowCount(tableName) {
    const tableInfo = this.getTable(tableName);
    if (tableInfo.rowCount > 0) {
      tableInfo.rowCount--;
    }
  }

  getRowCount(tableName) {
    return this.getTable(tableName).rowCount;
  }
}

module.exports = Catalog;
