/**
 * B+ Tree Index — Read Path
 * =========================
 *
 * A B+ Tree is a self-balancing tree optimized for disk-based storage and range queries.
 * It has two kinds of nodes:
 *
 * InternalNode:
 *   Holds sorted keys as routing "signposts" to guide search down the tree.
 *   Has (keys.length + 1) children — one more child than keys.
 *   Keys in children[i] are all < keys[i]; keys in children[last] are >= keys[last-1].
 *   Internal nodes do NOT store actual record data — they only route searches.
 *
 * LeafNode:
 *   Holds the actual key→recordId mappings (the index entries).
 *   All leaves are linked together via their `next` pointer, forming a doubly-linked
 *   list across the bottom level of the tree. This is the critical difference between
 *   a B-tree and a B+ tree: in a B-tree, data lives at every level, making range scans
 *   expensive (you'd need to traverse up and down). In a B+ tree, you find the start
 *   of the range in O(log N), then simply walk the leaf linked list — O(k) for k results.
 *
 * Why keys are kept sorted within every node:
 *   Sorted keys allow binary search (O(log n) per node) and, more importantly, let
 *   _findLeaf do a single left-to-right scan to find the first key[i] that is > the
 *   search key, branching into children[i] at that point. Without sorted keys, we
 *   would have no reliable way to know which subtree to descend into.
 *
 * Why _findLeaf uses `key < keys[i]`:
 *   Each keys[i] in an InternalNode acts as a boundary between children[i] and
 *   children[i+1]. If `key < keys[i]`, then by the sorted invariant, key must live
 *   entirely in the left subtree children[i]. We scan left-to-right and descend into
 *   the first child whose boundary key is greater than our search key.
 *   If no boundary key is exceeded, we fall into the rightmost child — the "catch-all"
 *   subtree for the largest keys.
 */

// ---------------------------------------------------------------------------
// LeafNode
// ---------------------------------------------------------------------------
class LeafNode {
  constructor() {
    this.isLeaf = true;

    // keys[i] → the indexed key (e.g. an integer primary key)
    // values[i] → the recordId that key maps to: { pageId, slotIndex }
    // Both arrays are kept in the same sorted order, so keys[i] and values[i]
    // always correspond to each other.
    this.keys = [];
    this.values = [];

    // next → pointer to the next leaf node in key order.
    // All leaf nodes form a singly-linked list, enabling efficient range scans:
    // find the start leaf once via _findLeaf, then walk `next` pointers.
    this.next = null;
  }
}

// ---------------------------------------------------------------------------
// InternalNode
// ---------------------------------------------------------------------------
class InternalNode {
  constructor() {
    this.isLeaf = false;

    // keys[i] is a separator/boundary: all keys in children[i] are < keys[i],
    // and all keys in children[i+1] are >= keys[i].
    // Invariant: children.length === keys.length + 1 at all times.
    this.keys = [];
    this.children = [];
  }
}

// ---------------------------------------------------------------------------
// BPlusTree
// ---------------------------------------------------------------------------
class BPlusTree {
  /**
   * @param {number} order - Maximum number of keys a node may hold before
   *   it must be split. Minimum meaningful value is 2 (order-2 B+ tree).
   *   A higher order means fewer tree levels (fewer I/Os) but larger nodes.
   */
  constructor(order = 4) {
    this.order = order;
    // An empty tree starts as a single empty leaf node — both the root
    // and the only leaf at the same time.
    this.root = new LeafNode();
  }

  // -------------------------------------------------------------------------
  // _findLeafPath(key)
  // -------------------------------------------------------------------------
  /**
   * Same descent logic as _findLeaf, but also records the full ancestor path
   * so that insert() knows which parent InternalNode to propagate a separator
   * key into after a leaf or internal split.
   *
   * Returns { leaf, path } where:
   *   leaf  — the destination LeafNode
   *   path  — array of InternalNodes from root down to leaf's parent,
   *            in top-down order (path[0] is the root if it is internal,
   *            path[path.length-1] is the direct parent of the leaf).
   *
   * @param {*} key
   * @returns {{ leaf: LeafNode, path: InternalNode[] }}
   */
  _findLeafPath(key) {
    const path = [];
    let node = this.root;

    while (!node.isLeaf) {
      path.push(node); // record this InternalNode as an ancestor

      let childIndex = node.keys.length; // default: rightmost child
      for (let i = 0; i < node.keys.length; i++) {
        if (key < node.keys[i]) {
          childIndex = i;
          break;
        }
      }

      node = node.children[childIndex];
    }

    return { leaf: node, path };
  }

  // -------------------------------------------------------------------------
  // _findLeaf(key)  — thin wrapper kept for backward compat with search()
  // -------------------------------------------------------------------------
  /**
   * Descends from the root to the leaf node where `key` belongs.
   * @param {*} key
   * @returns {LeafNode}
   */
  _findLeaf(key) {
    return this._findLeafPath(key).leaf;
  }

  // -------------------------------------------------------------------------
  // search(key)
  // -------------------------------------------------------------------------
  /**
   * Finds the recordId for an exact-match key lookup.
   *
   * 1. Descend to the correct leaf using _findLeaf — O(log N) in tree height.
   * 2. Linear-scan that leaf's small keys array for the exact key — O(order).
   *
   * Returns the matching recordId { pageId, slotIndex } or null if not found.
   *
   * @param {*} key
   * @returns {{ pageId: number, slotIndex: number } | null}
   */
  search(key) {
    const leaf = this._findLeaf(key);

    for (let i = 0; i < leaf.keys.length; i++) {
      if (leaf.keys[i] === key) {
        return leaf.values[i];
      }
    }

    return null; // key not present in the tree
  }

  // -------------------------------------------------------------------------
  // insert(key, recordId)
  // -------------------------------------------------------------------------
  /**
   * Inserts a key → recordId mapping into the tree.
   *
   * Steps:
   *   1. Walk root-to-leaf via _findLeafPath, recording the ancestor path.
   *   2. Insert (key, recordId) in sorted order into the leaf.
   *      If key already exists, overwrite its value (no duplicate keys).
   *   3. If the leaf overflows (keys.length > order), split it.
   *   4. Propagate any split separator key upward through ancestors.
   *   5. If the root itself splits, create a new InternalNode root.
   *
   * @param {*} key
   * @param {{ pageId: number, slotIndex: number }} recordId
   */
  insert(key, recordId) {
    const { leaf, path } = this._findLeafPath(key);

    // --- Step 1: Insert into leaf in sorted order ----------------------------
    // Find insertion position (first index where keys[i] >= key).
    let pos = leaf.keys.length;
    for (let i = 0; i < leaf.keys.length; i++) {
      if (key === leaf.keys[i]) {
        // Duplicate key → overwrite value and we are done.
        leaf.values[i] = recordId;
        return;
      }
      if (key < leaf.keys[i]) {
        pos = i;
        break;
      }
    }
    leaf.keys.splice(pos, 0, key);
    leaf.values.splice(pos, 0, recordId);

    // --- Step 2: Split the leaf if it overflowed ----------------------------
    if (leaf.keys.length <= this.order) return; // no overflow, done

    const { newNode: newLeaf, promotedKey } = this._splitLeaf(leaf);

    // --- Step 3: Propagate separator upward ----------------------------------
    this._insertIntoParent(path, leaf, promotedKey, newLeaf);
  }

  // -------------------------------------------------------------------------
  // _splitLeaf(leaf)
  // -------------------------------------------------------------------------
  /**
   * Splits an overflowing leaf into two leaves.
   *
   * WHY the middle key is COPIED (not moved) for leaf splits:
   *   Leaf nodes hold the actual key→recordId mappings. Range scans traverse
   *   the leaf linked list and read every key they encounter. If we removed the
   *   middle key from the old leaf and moved it only to the parent, that key's
   *   data entry would disappear from the leaves entirely — a range scan spanning
   *   that key would silently skip it. So the middle key STAYS in the new right
   *   leaf AND is also copied up as the separator in the parent.
   *
   * Layout after split (order = 4, so max 4 keys → split at index 2):
   *   old leaf:  keys[0..mid-1]           (lower half)
   *   new leaf:  keys[mid..end]            (upper half, mid key is KEPT here)
   *   separator key pushed to parent: newLeaf.keys[0]  (a copy of keys[mid])
   *
   * @param {LeafNode} leaf
   * @returns {{ newNode: LeafNode, promotedKey: * }}
   */
  _splitLeaf(leaf) {
    const mid = Math.ceil(leaf.keys.length / 2);

    const newLeaf = new LeafNode();
    newLeaf.keys   = leaf.keys.splice(mid);   // upper half moves to new leaf
    newLeaf.values = leaf.values.splice(mid);

    // Stitch the new leaf into the linked list.
    // Before: leaf → leaf.next
    // After:  leaf → newLeaf → (old leaf.next)
    newLeaf.next = leaf.next;
    leaf.next    = newLeaf;

    // The first key of the new leaf becomes the separator in the parent.
    // It is COPIED — it must remain in newLeaf so range scans can find it.
    return { newNode: newLeaf, promotedKey: newLeaf.keys[0] };
  }

  // -------------------------------------------------------------------------
  // _splitInternal(node)
  // -------------------------------------------------------------------------
  /**
   * Splits an overflowing InternalNode into two internal nodes.
   *
   * WHY the middle key is MOVED (not copied) for internal node splits:
   *   Internal nodes are pure routing structures — they hold separator keys
   *   only to guide searches, not to store actual data. When we split an
   *   internal node, its middle key is pushed up to the parent to separate
   *   the two halves. There is no reason to keep that key in the node because
   *   it will never be the target of a data lookup (all data lives in leaves).
   *   Keeping it would violate the invariant children.length === keys.length + 1.
   *
   * Layout after split (order = 4, indices 0-4 → mid = 2):
   *   old node:  keys[0..mid-1]            children[0..mid]
   *   promoted:  keys[mid]                 (MOVED out — not in either half)
   *   new node:  keys[mid+1..end]          children[mid+1..end]
   *
   * @param {InternalNode} node
   * @returns {{ newNode: InternalNode, promotedKey: * }}
   */
  _splitInternal(node) {
    const mid = Math.floor(node.keys.length / 2);
    const promotedKey = node.keys[mid]; // this key moves UP, removed from both halves

    const newNode = new InternalNode();
    newNode.keys     = node.keys.splice(mid + 1);      // upper keys (after mid)
    newNode.children = node.children.splice(mid + 1);  // upper children
    node.keys.splice(mid, 1); // remove the promoted key from the old node

    return { newNode, promotedKey };
  }

  // -------------------------------------------------------------------------
  // _insertIntoParent(path, leftNode, key, rightNode)
  // -------------------------------------------------------------------------
  /**
   * After a split, inserts the separator `key` (pointing right to `rightNode`)
   * into the parent of `leftNode`. If the parent also overflows, splits it
   * and recurses up the path. If the root splits, creates a new root.
   *
   * @param {InternalNode[]} path   - ancestor chain, root first
   * @param {LeafNode|InternalNode} leftNode
   * @param {*} key                  - separator key to insert into parent
   * @param {LeafNode|InternalNode} rightNode
   */
  _insertIntoParent(path, leftNode, key, rightNode) {
    if (path.length === 0) {
      // The node that split was the root → create a brand-new root above it.
      const newRoot = new InternalNode();
      newRoot.keys     = [key];
      newRoot.children = [leftNode, rightNode];
      this.root = newRoot;
      return;
    }

    const parent = path[path.length - 1];

    // Find where leftNode sits in parent.children, then insert the separator
    // key and the new right child immediately after it.
    const idx = parent.children.indexOf(leftNode);
    parent.keys.splice(idx, 0, key);
    parent.children.splice(idx + 1, 0, rightNode);

    // Does the parent now overflow?
    if (parent.keys.length <= this.order) return; // no further action needed

    // Split the parent and recurse upward with the grandparent's path.
    const { newNode: newParent, promotedKey } = this._splitInternal(parent);
    this._insertIntoParent(path.slice(0, -1), parent, promotedKey, newParent);
  }

  // -------------------------------------------------------------------------
  // rangeSearch(minKey, maxKey)
  // -------------------------------------------------------------------------
  /**
   * Returns an array of all { key, recordId } pairs whose key is in
   * [minKey, maxKey] inclusive, in ascending key order.
   *
   * Strategy:
   *   1. Use _findLeaf(minKey) to jump directly to the leaf where minKey
   *      would live — O(log N). This is the key advantage of B+ trees over
   *      hash indexes: we get a cheap O(log N) entry point into a sorted scan.
   *   2. Walk forward through the leaf linked list collecting values until
   *      we either exceed maxKey or exhaust all leaves — O(k) for k results.
   *
   * @param {*} minKey
   * @param {*} maxKey
   * @returns {Array<{ key: *, recordId: * }>}
   */
  rangeSearch(minKey, maxKey) {
    const results = [];
    let leaf = this._findLeaf(minKey);

    while (leaf !== null) {
      for (let i = 0; i < leaf.keys.length; i++) {
        const k = leaf.keys[i];
        if (k > maxKey) return results; // passed the upper bound — done
        if (k >= minKey) {
          results.push({ key: k, recordId: leaf.values[i] });
        }
      }
      leaf = leaf.next; // advance to the next leaf page
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // delete(key)
  // -------------------------------------------------------------------------
  /**
   * Removes the entry for `key` from the tree.
   *
   * Returns true if the key was found and deleted, false if it wasn't present.
   *
   * High-level steps:
   *   1. Locate the leaf and its ancestor path via _findLeafPath.
   *   2. Remove the key+value from the leaf.
   *   3. If the leaf underflows (fewer than minKeys entries) and is not the
   *      root, attempt to fix it:
   *
   * Borrow vs. Merge decision:
   *   We first look at adjacent siblings (via the parent's children array).
   *   - BORROW: If a sibling has more than the minimum number of keys, we
   *     take one key from it and update the separator in the parent. This is
   *     preferred because it keeps both nodes alive and avoids rebalancing
   *     higher in the tree.
   *   - MERGE: If no sibling can spare a key, we merge the leaf with a sibling
   *     into one node, delete the now-redundant separator from the parent, and
   *     fix up the leaf linked list. The parent may then underflow too, so we
   *     propagate the underflow fix upward through the ancestor path.
   *
   * NOTE: This implementation handles one level of underflow propagation
   * correctly for both leaf and internal nodes. Production databases (e.g.
   * PostgreSQL, InnoDB) handle additional edge cases around cascading
   * multi-level merges all the way up to the root, root collapse (when the
   * root becomes empty after its last two children merge), and concurrency
   * via page-level latching. Those are intentionally out of scope here.
   *
   * @param {*} key
   * @returns {boolean}
   */
  delete(key) {
    const { leaf, path } = this._findLeafPath(key);

    // --- Step 1: Find and remove the key from the leaf ----------------------
    const keyIdx = leaf.keys.indexOf(key);
    if (keyIdx === -1) return false; // key not in tree

    leaf.keys.splice(keyIdx, 1);
    leaf.values.splice(keyIdx, 1);

    // --- Step 2: Check for underflow ----------------------------------------
    const minKeys = Math.ceil(this.order / 2);

    // If the leaf is the root (tree has only one node), or it still has
    // enough keys, we are done.
    if (path.length === 0 || leaf.keys.length >= minKeys) return true;

    // --- Step 3: Fix underflow ----------------------------------------------
    this._handleLeafUnderflow(leaf, path);
    return true;
  }

  // -------------------------------------------------------------------------
  // _handleLeafUnderflow(leaf, path)
  // -------------------------------------------------------------------------
  /**
   * Attempts to fix a leaf underflow by borrowing from a sibling or merging.
   *
   * @param {LeafNode} leaf
   * @param {InternalNode[]} path - ancestor chain, root first
   */
  _handleLeafUnderflow(leaf, path) {
    const parent    = path[path.length - 1];
    const leafIdx   = parent.children.indexOf(leaf);
    const minKeys   = Math.ceil(this.order / 2);

    // Prefer the right sibling, fall back to left sibling.
    const rightSibIdx = leafIdx + 1 < parent.children.length ? leafIdx + 1 : -1;
    const leftSibIdx  = leafIdx - 1 >= 0                     ? leafIdx - 1 : -1;

    // --- Try borrowing from the RIGHT sibling --------------------------------
    if (rightSibIdx !== -1) {
      const rightSib = parent.children[rightSibIdx];
      if (rightSib.keys.length > minKeys) {
        // Take the first (smallest) key from the right sibling.
        leaf.keys.push(rightSib.keys.shift());
        leaf.values.push(rightSib.values.shift());
        // The separator in the parent must now point to the new smallest key
        // of the right sibling (since we took its old first key).
        parent.keys[leafIdx] = rightSib.keys[0];
        return;
      }
    }

    // --- Try borrowing from the LEFT sibling ---------------------------------
    if (leftSibIdx !== -1) {
      const leftSib = parent.children[leftSibIdx];
      if (leftSib.keys.length > minKeys) {
        // Take the last (largest) key from the left sibling.
        leaf.keys.unshift(leftSib.keys.pop());
        leaf.values.unshift(leftSib.values.pop());
        // The separator between leftSib and leaf in the parent is now the
        // new first key of the (now larger) leaf.
        parent.keys[leftSibIdx] = leaf.keys[0];
        return;
      }
    }

    // --- Neither sibling can spare a key → MERGE ----------------------------
    if (rightSibIdx !== -1) {
      // Merge leaf into the right sibling (absorb right into left).
      const rightSib = parent.children[rightSibIdx];
      // Pull all of right's entries into leaf.
      leaf.keys.push(...rightSib.keys);
      leaf.values.push(...rightSib.values);
      // Fix up the linked list: leaf now points to what rightSib pointed to.
      leaf.next = rightSib.next;
      // Remove the separator key and the right sibling child from the parent.
      parent.keys.splice(leafIdx, 1);
      parent.children.splice(rightSibIdx, 1);
    } else {
      // Merge left sibling into leaf (absorb leaf into left).
      const leftSib = parent.children[leftSibIdx];
      leftSib.keys.push(...leaf.keys);
      leftSib.values.push(...leaf.values);
      leftSib.next = leaf.next;
      // Remove the separator and the leaf child from the parent.
      parent.keys.splice(leftSibIdx, 1);
      parent.children.splice(leafIdx, 1);
    }

    // --- Propagate underflow in the parent if needed ------------------------
    if (path.length === 1) {
      // Parent is the root. If it is now empty, collapse it.
      if (parent.keys.length === 0) {
        this.root = parent.children[0];
      }
      return;
    }

    const minInternal = Math.ceil(this.order / 2);
    if (parent.keys.length >= minInternal) return; // parent is fine

    this._handleInternalUnderflow(parent, path.slice(0, -1));
  }

  // -------------------------------------------------------------------------
  // _handleInternalUnderflow(node, path)
  // -------------------------------------------------------------------------
  /**
   * Attempts to fix an internal node underflow by borrowing from a sibling
   * or merging with one. Mirrors _handleLeafUnderflow but for InternalNodes.
   *
   * NOTE: Unlike leaf merges (which COPY the separator), internal merges
   * PULL DOWN the parent separator into the merged node — because internal
   * nodes don't hold data, the separator belongs logically between the two
   * halves and must be preserved to maintain the children.length === keys.length+1
   * invariant.
   *
   * @param {InternalNode} node
   * @param {InternalNode[]} path - ancestors ABOVE node, root first
   */
  _handleInternalUnderflow(node, path) {
    const parent    = path[path.length - 1];
    const nodeIdx   = parent.children.indexOf(node);
    const minKeys   = Math.ceil(this.order / 2);

    const rightSibIdx = nodeIdx + 1 < parent.children.length ? nodeIdx + 1 : -1;
    const leftSibIdx  = nodeIdx - 1 >= 0                     ? nodeIdx - 1 : -1;

    // --- Try borrowing from RIGHT sibling ------------------------------------
    if (rightSibIdx !== -1) {
      const rightSib = parent.children[rightSibIdx];
      if (rightSib.keys.length > minKeys) {
        // Pull the parent separator down into node, push right's first key up.
        node.keys.push(parent.keys[nodeIdx]);
        parent.keys[nodeIdx] = rightSib.keys.shift();
        node.children.push(rightSib.children.shift());
        return;
      }
    }

    // --- Try borrowing from LEFT sibling -------------------------------------
    if (leftSibIdx !== -1) {
      const leftSib = parent.children[leftSibIdx];
      if (leftSib.keys.length > minKeys) {
        node.keys.unshift(parent.keys[leftSibIdx]);
        parent.keys[leftSibIdx] = leftSib.keys.pop();
        node.children.unshift(leftSib.children.pop());
        return;
      }
    }

    // --- MERGE ---------------------------------------------------------------
    if (rightSibIdx !== -1) {
      const rightSib = parent.children[rightSibIdx];
      // Pull the parent separator between node and rightSib down into node.
      node.keys.push(parent.keys[nodeIdx]);
      node.keys.push(...rightSib.keys);
      node.children.push(...rightSib.children);
      parent.keys.splice(nodeIdx, 1);
      parent.children.splice(rightSibIdx, 1);
    } else {
      const leftSib = parent.children[leftSibIdx];
      leftSib.keys.push(parent.keys[leftSibIdx]);
      leftSib.keys.push(...node.keys);
      leftSib.children.push(...node.children);
      parent.keys.splice(leftSibIdx, 1);
      parent.children.splice(nodeIdx, 1);
    }

    // Collapse root if it is now empty.
    if (path.length === 1) {
      if (parent.keys.length === 0) this.root = parent.children[0];
      return;
    }

    if (parent.keys.length >= minKeys) return;
    this._handleInternalUnderflow(parent, path.slice(0, -1));
  }
}

module.exports = { BPlusTree, LeafNode, InternalNode };
