import {
  rectangle,
  textInContainer,
  arrow,
  wrapScene,
  estimateTextWidth,
} from "../lib/elements.mjs";

/** Reserve columns by measured label width and rows by subtree height. */
export function generateTree(spec) {
  if (!spec.root)
    throw new Error("tree spec needs a root: {label, children:[...]}");
  const levels = [];
  const measure = (input, depth = 0) => {
    const node = typeof input === "string" ? { label: input } : input;
    const width = Math.max(
      160,
      ...node.label.split("\n").map((line) => estimateTextWidth(line, 20) + 48),
    );
    const height = Math.max(56, node.label.split("\n").length * 25 + 24);
    levels[depth] = Math.max(levels[depth] ?? 0, width);
    const children = (node.children ?? []).map((child) =>
      measure(child, depth + 1),
    );
    const childrenHeight =
      children.reduce((sum, child) => sum + child.span, 0) +
      Math.max(0, children.length - 1) * 32;
    return {
      ...node,
      depth,
      width,
      height,
      children,
      span: Math.max(height, childrenHeight),
      childrenHeight,
    };
  };
  const root = measure({
    ...spec.root,
    children: spec.root.children ?? spec.children ?? [],
  });
  const columns = [0];
  for (let i = 1; i < levels.length; i++)
    columns[i] = columns[i - 1] + levels[i - 1] + 100;
  const elements = [];
  const build = (node, top, parent) => {
    const centerY = top + node.span / 2;
    const box = rectangle(
      columns[node.depth],
      centerY - node.height / 2,
      node.width,
      node.height,
      { backgroundColor: node.color ?? "#e7f5ff" },
    );
    elements.push(box, textInContainer(box, node.label, { fontSize: 20 }));
    if (parent) elements.push(arrow(parent, box));
    let childY = centerY - node.childrenHeight / 2;
    for (const child of node.children) {
      build(child, childY, box);
      childY += child.span + 32;
    }
  };
  build(root, -root.span / 2, null);
  return wrapScene(elements, spec.title ?? "tree");
}
