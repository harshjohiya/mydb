const assert = require('assert');
const { BPlusTree, LeafNode, InternalNode } = require('../src/index/btree');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect every key across all leaves in linked-list order (left → right). */
function collectLeafKeys(tree) {
  const keys = [];
  // Walk to the leftmost leaf
  let node = tree.root;
  while (!node.isLeaf) node = node.children[0];
  // Traverse linked list
  while (node !== null) {
    for (const k of node.keys) keys.push(k);
    node = node.next;
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function testSearchEmptyTree() {
  const tree = new BPlusTree(4);
  assert.strictEqual(tree.search(1), null);
  assert.strictEqual(tree.search(99), null);
  console.log('✓ testSearchEmptyTree passed');
}

function testInsertAndSearch() {
  const tree = new BPlusTree(4);
  const rid = { pageId: 0, slotIndex: 0 };
  tree.insert(10, rid);
  const result = tree.search(10);
  assert.deepStrictEqual(result, rid);
  assert.strictEqual(tree.search(99), null); // not inserted
  console.log('✓ testInsertAndSearch passed');
}

function testDuplicateKeyOverwrite() {
  const tree = new BPlusTree(4);
  tree.insert(5, { pageId: 0, slotIndex: 0 });
  tree.insert(5, { pageId: 1, slotIndex: 3 }); // overwrite
  const result = tree.search(5);
  assert.deepStrictEqual(result, { pageId: 1, slotIndex: 3 });
  console.log('✓ testDuplicateKeyOverwrite passed');
}

function testMultipleInsertsSortedLeaf() {
  const tree = new BPlusTree(4);
  // Insert in random order — keys inside the leaf should stay sorted
  [5, 3, 8, 1, 7].forEach((k, i) => tree.insert(k, { pageId: 0, slotIndex: i }));

  // All must be searchable
  [5, 3, 8, 1, 7].forEach(k => {
    assert.notStrictEqual(tree.search(k), null, `key ${k} should be found`);
  });

  // Leaf keys must be in ascending order
  const keys = collectLeafKeys(tree);
  const sorted = [...keys].sort((a, b) => a - b);
  assert.deepStrictEqual(keys, sorted);
  console.log('✓ testMultipleInsertsSortedLeaf passed');
}

function testLeafSplitOccurs() {
  // order = 3: a leaf can hold at most 3 keys; 4th insert must trigger split
  const tree = new BPlusTree(3);
  [10, 20, 30, 40].forEach((k, i) => tree.insert(k, { pageId: 0, slotIndex: i }));

  // After splitting, the root must now be an InternalNode
  assert.strictEqual(tree.root.isLeaf, false,
    'root should be an InternalNode after a leaf split');

  // All keys must still be reachable
  [10, 20, 30, 40].forEach(k => {
    assert.notStrictEqual(tree.search(k), null, `key ${k} should survive the split`);
  });
  console.log('✓ testLeafSplitOccurs passed');
}

function testLeafLinkedListOrder() {
  // Insert enough keys to force multiple splits, then verify the leaf
  // linked list is in fully sorted ascending order.
  const tree = new BPlusTree(3);
  const keys = [15, 5, 25, 10, 20, 30, 1, 8];
  keys.forEach((k, i) => tree.insert(k, { pageId: 0, slotIndex: i }));

  const leafKeys = collectLeafKeys(tree);
  const expected = [...keys].sort((a, b) => a - b);
  assert.deepStrictEqual(leafKeys, expected,
    'leaf linked list must contain all keys in sorted order');
  console.log('✓ testLeafLinkedListOrder passed');
}

function testInternalNodeSplit() {
  // With order = 2, each node overflows after 2 keys.
  // Inserting 7 keys forces at least one internal node split.
  const tree = new BPlusTree(2);
  [10, 20, 30, 40, 50, 60, 70].forEach((k, i) =>
    tree.insert(k, { pageId: 0, slotIndex: i })
  );

  // All keys must still be reachable after multi-level splits
  [10, 20, 30, 40, 50, 60, 70].forEach(k => {
    assert.notStrictEqual(tree.search(k), null,
      `key ${k} should be found after internal splits`);
  });

  // Leaf list must still be fully sorted
  const leafKeys = collectLeafKeys(tree);
  const expected = [10, 20, 30, 40, 50, 60, 70];
  assert.deepStrictEqual(leafKeys, expected);
  console.log('✓ testInternalNodeSplit passed');
}

function testRangeScan() {
  // After inserts, walk the leaf linked list to collect keys in [low, high].
  const tree = new BPlusTree(3);
  [1, 5, 10, 15, 20, 25, 30].forEach((k, i) =>
    tree.insert(k, { pageId: 0, slotIndex: i })
  );

  // Manual range scan: find start leaf, walk next pointers
  function rangeScan(tree, low, high) {
    const { BPlusTree: _B, ..._ } = require('../src/index/btree');
    let node = tree.root;
    while (!node.isLeaf) {
      let ci = node.keys.length;
      for (let i = 0; i < node.keys.length; i++) {
        if (low < node.keys[i]) { ci = i; break; }
      }
      node = node.children[ci];
    }
    const results = [];
    while (node !== null) {
      for (let i = 0; i < node.keys.length; i++) {
        if (node.keys[i] >= low && node.keys[i] <= high) {
          results.push(node.keys[i]);
        }
        if (node.keys[i] > high) return results;
      }
      node = node.next;
    }
    return results;
  }

  const results = rangeScan(tree, 5, 20);
  assert.deepStrictEqual(results, [5, 10, 15, 20]);
  console.log('✓ testRangeScan passed');
}

// ---------------------------------------------------------------------------
// Run all
// ---------------------------------------------------------------------------
function runAllTests() {
  console.log('Running Week 2 tests...');
  testSearchEmptyTree();
  testInsertAndSearch();
  testDuplicateKeyOverwrite();
  testMultipleInsertsSortedLeaf();
  testLeafSplitOccurs();
  testLeafLinkedListOrder();
  testInternalNodeSplit();
  testRangeScan();
  console.log('All Week 2 tests passed');
}

runAllTests();
