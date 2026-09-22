import {
  ellipse,
  rectangle,
  textInContainer,
  arrow,
  wrapScene,
  estimateTextWidth,
} from "../lib/elements.mjs";

const widthFor = (label, font, minimum) =>
  Math.max(
    minimum,
    ...String(label)
      .split("\n")
      .map((line) => estimateTextWidth(line, font) + 56),
  );
const heightFor = (label, font, minimum) =>
  Math.max(minimum, String(label).split("\n").length * font * 1.25 + 24);

/** Balance each side independently, reserving enough space for every subtree. */
export function generateMindmap(spec) {
  const branches = spec.branches ?? [];
  if (!branches.length)
    throw new Error("mindmap spec needs at least one branch");
  const label = spec.root?.label ?? spec.title ?? "Root";
  const rootW = widthFor(label, 24, 260) * 1.2,
    rootH = heightFor(label, 24, 110);
  const root = ellipse(-rootW / 2, -rootH / 2, rootW, rootH, {
    backgroundColor: spec.root?.color ?? "#dbe4ff",
  });
  const elements = [root, textInContainer(root, label, { fontSize: 24 })];
  for (const side of [1, -1]) {
    const items = branches
      .filter((_, i) => (i % 2 === 0 ? 1 : -1) === side)
      .map((branch) => {
        const children = (branch.children ?? []).map((label) => ({
          label,
          width: widthFor(label, 16, 160),
          height: heightFor(label, 16, 48),
        }));
        const childrenHeight =
          children.reduce((sum, child) => sum + child.height, 0) +
          Math.max(0, children.length - 1) * 24;
        return {
          ...branch,
          children,
          childrenHeight,
          height: heightFor(branch.label, 20, 60),
          span: Math.max(heightFor(branch.label, 20, 60), childrenHeight),
        };
      });
    let cursor =
      -(
        items.reduce((sum, b) => sum + b.span, 0) +
        Math.max(0, items.length - 1) * 64
      ) / 2;
    for (const b of items) {
      const centerY = cursor + b.span / 2,
        width = widthFor(b.label, 20, 220);
      const x = side === 1 ? rootW / 2 + 120 : -rootW / 2 - 120 - width;
      const branch = rectangle(x, centerY - b.height / 2, width, b.height, {
        backgroundColor: "#fff3bf",
      });
      elements.push(
        branch,
        textInContainer(branch, b.label, { fontSize: 20 }),
        arrow(root, branch),
      );
      let childY = centerY - b.childrenHeight / 2;
      for (const child of b.children) {
        const childX = side === 1 ? x + width + 100 : x - 100 - child.width;
        const box = rectangle(childX, childY, child.width, child.height, {
          backgroundColor: "#e7f5ff",
        });
        elements.push(
          box,
          textInContainer(box, child.label, { fontSize: 16 }),
          arrow(branch, box),
        );
        childY += child.height + 24;
      }
      cursor += b.span + 64;
    }
  }
  return wrapScene(elements, spec.title ?? "mindmap");
}
