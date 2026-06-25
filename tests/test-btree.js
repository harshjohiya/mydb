const assert = require('assert');
const { BPlusTree } = require('../src/index/btree');

function testInsertAndSearch() {
  const tree = new BPlusTree(4);
  const keys = [7, 2, 9, 1, 5, 8, 3, 10, 6, 4];
  
  // Insert in random order
  keys.forEach(k => tree.insert(k, { pageId: 0, slotIndex: k }));

  // Assert search() finds every one
  keys.forEach(k => {
    const res = tree.search(k);
    assert.notStrictEqual(res, null);
    assert.strictEqual(res.slotIndex, k);
  });

  // Assert search() on missing key returns null
  assert.strictEqual(tree.search(99), null);
  
  console.log('✓ testInsertAndSearch passed');
}

function testSplitting() {
  const tree = new BPlusTree(4);
  
  // Insert 20 keys to force multiple splits
  for (let i = 1; i <= 20; i++) {
    tree.insert(i, { pageId: 1, slotIndex: i });
  }

  // Assert every key is still searchable
  for (let i = 1; i <= 20; i++) {
    const res = tree.search(i);
    assert.notStrictEqual(res, null);
    assert.strictEqual(res.slotIndex, i);
  }
  
  console.log('✓ testSplitting passed');
}

function testRangeSearch() {
  const tree = new BPlusTree(4);
  
  // Insert keys 1 through 20
  for (let i = 1; i <= 20; i++) {
    tree.insert(i, { pageId: 2, slotIndex: i });
  }

  // Call rangeSearch(5, 15)
  const results = tree.rangeSearch(5, 15);
  
  // Assert exactly 11 expected values in ascending order
  assert.strictEqual(results.length, 11);
  for (let i = 0; i < 11; i++) {
    const expectedKey = i + 5;
    assert.strictEqual(results[i].key, expectedKey);
    assert.strictEqual(results[i].recordId.slotIndex, expectedKey);
  }
  
  console.log('✓ testRangeSearch passed');
}

function testDelete() {
  const tree = new BPlusTree(4);
  
  // Insert ~15 keys
  for (let i = 1; i <= 15; i++) {
    tree.insert(i, { pageId: 3, slotIndex: i });
  }

  // Delete a handful
  const toDelete = [3, 7, 12, 14, 15];
  toDelete.forEach(k => {
    assert.strictEqual(tree.delete(k), true);
  });

  // Assert deleted keys return null
  toDelete.forEach(k => {
    assert.strictEqual(tree.search(k), null);
  });

  // Assert remaining keys are still found correctly
  for (let i = 1; i <= 15; i++) {
    if (!toDelete.includes(i)) {
      const res = tree.search(i);
      assert.notStrictEqual(res, null);
      assert.strictEqual(res.slotIndex, i);
    }
  }
  
  console.log('✓ testDelete passed');
}

function testDeleteNonExistentKey() {
  const tree = new BPlusTree(4);
  tree.insert(10, { pageId: 4, slotIndex: 10 });
  
  // Assert delete() on a never-inserted key returns false
  const deleted = tree.delete(99);
  assert.strictEqual(deleted, false);
  
  // Assert it doesn't corrupt the tree
  const res = tree.search(10);
  assert.notStrictEqual(res, null);
  assert.strictEqual(res.slotIndex, 10);
  
  console.log('✓ testDeleteNonExistentKey passed');
}

// Call all five at the bottom
console.log('Running BTree tests...');
testInsertAndSearch();
testSplitting();
testRangeSearch();
testDelete();
testDeleteNonExistentKey();
console.log('All BTree tests passed');
