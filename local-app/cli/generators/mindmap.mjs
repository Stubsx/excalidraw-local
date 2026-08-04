import {
  ellipse,
  rectangle,
  textInContainer,
  arrow,
  grid,
  wrapScene,
  estimateTextWidth,
} from "../lib/elements.mjs";

/** Min width + horizontal padding so labels never get clipped. */
const NODE_PAD = 28;
function widthFor(label, fontSize, minW) {
  return Math.max(minW, estimateTextWidth(label, fontSize) + NODE_PAD * 2);
}

/**
 * Mindmap generator: a central root node with branches radiating outward.
 *
 * spec:
 *   { title, root: {label, color}, branches: [{label, children: [..]}] }
 *
 * Layout: root centered; branches arranged left/right alternating by index;
 * each branch is a container with its label, plus child containers stacked
 * vertically beside it. Arrows connect root→branch and branch→children.
 *
 * Returns a full .excalidraw scene object.
 */
export function generateMindmap(spec) {
  const branches = spec.branches ?? [];
  if (branches.length === 0) {
    throw new Error("mindmap spec needs at least one branch");
  }

  const rootW = 260;
  const rootH = 110;
  // Canvas center-ish; root placed at a fixed origin, everything offsets from it.
  const rootCx = 0;
  const rootCy = 0;
  const root = ellipse(rootCx - rootW / 2, rootCy - rootH / 2, rootW, rootH, {
    backgroundColor: spec.root?.color ?? "#4d96ff",
  });
  const rootText = textInContainer(root, spec.root?.label ?? spec.title ?? "Root", {
    fontSize: 24,
  });

  const elements = [root, rootText];

  // Vertical spread per branch, alternating sides.
  const branchGap = 140; // vertical gap between branches
  const totalHeight = branches.length * branchGap;
  const startY = grid(-totalHeight / 2);

  const branchNodes = [];

  branches.forEach((b, i) => {
    const side = i % 2 === 0 ? 1 : -1; // right / left
    const y = startY + i * branchGap;
    const bx = grid(rootCx + side * 360);
    const by = grid(y - 30);
    const bw = widthFor(b.label, 20, 220);
    const bh = 60;
    const branch = rectangle(bx, by, bw, bh, {
      backgroundColor: "#fff3bf",
    });
    const branchText = textInContainer(branch, b.label, { fontSize: 20 });
    elements.push(branch, branchText);

    // root → branch arrow
    elements.push(arrow(root, branch));

    // children stacked vertically beside the branch
    const childSide = side;
    // child column x depends on the branch width so they clear the branch box.
    const childOffset = bw + 60;
    const childFontSize = 16;
    (b.children ?? []).forEach((childLabel, ci) => {
      const cw = widthFor(childLabel, childFontSize, 160);
      const ch = 44;
      const cx = grid(bx + childSide * childOffset);
      const cy = grid(by - ((b.children.length - 1) * 56) / 2 + ci * 56);
      const child = rectangle(cx, cy, cw, ch, {
        backgroundColor: "#d0ebff",
        strokeWidth: 1,
      });
      const childText = textInContainer(child, childLabel, {
        fontSize: childFontSize,
      });
      elements.push(child, childText);
      elements.push(arrow(branch, child));
    });

    branchNodes.push(branch);
  });

  return wrapScene(elements, spec.title ?? "mindmap");
}
