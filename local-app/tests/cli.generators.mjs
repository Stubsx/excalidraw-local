import { test } from "node:test";
import assert from "node:assert/strict";
import { generateMindmap } from "../cli/generators/mindmap.mjs";
import { generateTree } from "../cli/generators/tree.mjs";

function verifyLayout(scene) {
  const boxes = scene.elements.filter(
    (e) => e.type === "rectangle" || e.type === "ellipse",
  );
  for (const [i, a] of boxes.entries()) {
    for (const b of boxes.slice(i + 1)) {
      assert.ok(
        a.x + a.width <= b.x ||
          b.x + b.width <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y,
        "Node boxes must not overlap",
      );
    }
  }
  const map = new Map(boxes.map((box) => [box.id, box]));
  const inside = (box, x, y) =>
    box.type === "ellipse"
      ? ((x - box.x - box.width / 2) / (box.width / 2)) ** 2 +
          ((y - box.y - box.height / 2) / (box.height / 2)) ** 2 <
        1
      : x > box.x &&
        x < box.x + box.width &&
        y > box.y &&
        y < box.y + box.height;
  for (const arrow of scene.elements.filter((e) => e.type === "arrow")) {
    const start = arrow.points[0],
      end = arrow.points.at(-1);
    assert.equal(
      inside(
        map.get(arrow.startBinding.elementId),
        arrow.x + start[0],
        arrow.y + start[1],
      ),
      false,
      "Start must clear the label container",
    );
    assert.equal(
      inside(
        map.get(arrow.endBinding.elementId),
        arrow.x + end[0],
        arrow.y + end[1],
      ),
      false,
      "End must clear the label container",
    );
    assert.equal(arrow.endBinding.mode, "orbit");
  }
}

test("mindmap reserves space for long labels and uneven child groups", () => {
  const spec = {
    root: { label: "长名称的核心节点" },
    branches: Array.from({ length: 6 }, (_, i) => ({
      label: `分支 ${i}`,
      children: Array.from(
        { length: i + 1 },
        (_, j) => `较长的子节点内容 ${j}\n第二行`,
      ),
    })),
  };
  const before = JSON.stringify(spec);
  verifyLayout(generateMindmap(spec));
  assert.equal(JSON.stringify(spec), before);
});

test("tree measures each column and preserves the input spec", () => {
  const spec = {
    root: {
      label: "一个超过固定列宽的很长很长的根节点名称",
      children: [
        { label: "部门一", children: ["事项 A", "事项 B"] },
        { label: "部门二\n附加信息" },
      ],
    },
  };
  const before = JSON.stringify(spec);
  verifyLayout(generateTree(spec));
  assert.equal(JSON.stringify(spec), before);
});
