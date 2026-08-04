import {
  rectangle,
  textInContainer,
  arrow,
  grid,
  wrapScene,
} from "../lib/elements.mjs";

/**
 * Hierarchical tree generator (left → right).
 *
 * spec:
 *   { title, root: {label}, children: [{label, children:[{label}]}] }
 *
 * Each level moves right by LEVEL_DX; siblings stack vertically. Node boxes
 * auto-size to label width. Arrows connect parent → child.
 */
export function generateTree(spec) {
  if (!spec.root) {
    throw new Error("tree spec needs a root: {label, children:[...]}");
  }
  // Normalize: root may carry its own children, or they may be at spec top
  // level for convenience. Prefer root.children.
  if (!spec.root.children && Array.isArray(spec.children)) {
    spec.root = { ...spec.root, children: spec.children };
  }

  const LEVEL_DX = 320; // horizontal step per depth
  const NODE_H = 56;
  const SIBLING_GAP = 24;
  const PAD_X = 24;
  const FONT = 20;

  const elements = [];

  // First pass: assign every node an (depth, ySlot) and measure width.
  // We compute leaf count per subtree to distribute vertical space.
  let leafCursor = 0;
  function layout(node, depth) {
    const kids = node.children ?? [];
    if (kids.length === 0) {
      node._ySlot = leafCursor++;
    } else {
      kids.forEach((k) => layout(k, depth + 1));
      node._ySlot =
        (kids[0]._ySlot + kids[kids.length - 1]._ySlot) / 2;
    }
    node._depth = depth;
  }
  layout(spec.root, 0);

  const leafCount = Math.max(1, leafCursor);
  const rowH = NODE_H + SIBLING_GAP;
  const totalH = leafCount * rowH;
  const yForSlot = (slot) => grid(slot * rowH - totalH / 2);

  // Second pass: create boxes + arrows.
  function build(node, parentBox) {
    const x = grid(node._depth * LEVEL_DX);
    const y = yForSlot(node._ySlot);
    const labelW = Math.max(120, estimateLabelWidth(node.label, FONT) + PAD_X * 2);
    const box = rectangle(x, y, labelW, NODE_H, {
      backgroundColor: node.color ?? "#a5d8ff",
    });
    const t = textInContainer(box, node.label, { fontSize: FONT });
    elements.push(box, t);
    if (parentBox) {
      elements.push(arrow(parentBox, box));
    }
    (node.children ?? []).forEach((c) => build(c, box));
  }
  build(spec.root, null);

  return wrapScene(elements, spec.title ?? "tree");
}

// local copy to avoid a circular import just for width estimation
function estimateLabelWidth(text, fontSize) {
  let w = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    const isCJK =
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3000 && code <= 0x30ff) ||
      (code >= 0xff00 && code <= 0xffef);
    w += isCJK ? fontSize : fontSize * 0.6;
  }
  return w;
}
