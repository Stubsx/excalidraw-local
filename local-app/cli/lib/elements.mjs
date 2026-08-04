import { randomBytes } from "node:crypto";

/**
 * Excalidraw element factory.
 *
 * Encapsulates all the field hygiene the upstream SKILL.md warns about:
 *   - id (random), seed (random int), versionNonce (random int)
 *   - version, updated (timestamp)
 *   - sane defaults for stroke/fill/roughness/opacity
 *
 * Also provides text-width estimation (CJK/ASCII) and container+text pairing
 * (boundElements / containerId), so generators never touch raw fields.
 */

let _seq = 0;
/** Monotonic index string for z-ordering (fractional-indexing-lite). */
function nextIndex() {
  _seq += 1;
  // simple sortable base36; fine within a single generated scene
  return _seq.toString(36).padStart(4, "0");
}

/** A short random id (collision-safe within one scene). */
export function rid(len = 10) {
  return randomBytes(len)
    .toString("base64url")
    .replace(/[-_]/g, "")
    .slice(0, len);
}

/** Random integer for seed / versionNonce (Excalidraw uses 0..2^31). */
function randInt() {
  return randomBytes(4).readUInt32BE(0) & 0x7fffffff;
}

const now = () => Date.now();

/**
 * Estimate the rendered width (px) of a text string.
 * CJK ≈ fontSize px/char; ASCII letters/digits ≈ 0.62×fontSize; punctuation
 * and slashes are slightly wider. Deliberately OVER-estimates a touch so that
 * generated containers never clip their labels.
 */
export function estimateTextWidth(text, fontSize) {
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    const isCJK =
      (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified
      (code >= 0x3000 && code <= 0x30ff) || // CJK punctuation / kana
      (code >= 0xff00 && code <= 0xffef); // Fullwidth forms
    if (isCJK) {
      width += fontSize;
    } else if (/[a-z0-9]/.test(ch)) {
      width += fontSize * 0.62;
    } else if (/[A-Z]/.test(ch)) {
      width += fontSize * 0.72;
    } else if (/[/\-_.:]/.test(ch)) {
      width += fontSize * 0.55;
    } else {
      width += fontSize * 0.7; // other punctuation/space
    }
  }
  return width;
}

/** Default stroke/fill style — hand-drawn look (roughness 1, hachure fill). */
const DEFAULT_STYLE = {
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "hachure",
  strokeWidth: 1,
  strokeStyle: "solid",
  roughness: 1,
  opacity: 100,
};

/** Common base fields every element needs. */
function base(type, x, y, width, height, opts = {}) {
  return {
    id: rid(),
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    ...DEFAULT_STYLE,
    groupIds: [],
    frameId: null,
    index: nextIndex(),
    seed: randInt(),
    version: 1,
    versionNonce: randInt(),
    isDeleted: false,
    boundElements: [],
    updated: now(),
    link: null,
    locked: false,
    ...opts,
  };
}

/**
 * A rectangle (box) container. Width/height are explicit so generators control
 * layout precisely.
 */
export function rectangle(x, y, width, height, opts = {}) {
  return base("rectangle", x, y, width, height, { ...opts });
}

/** An ellipse container. */
export function ellipse(x, y, width, height, opts = {}) {
  return base("ellipse", x, y, width, height, {
    backgroundColor: opts.backgroundColor ?? "#a5d8ff",
    ...opts,
  });
}

/**
 * A text element bound to a container (auto-centered).
 * Registers itself on the container's boundElements and sets containerId.
 */
export function textInContainer(container, text, opts = {}) {
  const fontSize = opts.fontSize ?? 20;
  const lineHeight = fontSize * 1.25;
  const fontFamily = opts.fontFamily ?? 5; // 5 = Excalifont
  const align = opts.textAlign ?? "center";

  const lines = text.split("\n");
  // Width: longest line; cap by container width.
  const longest = Math.max(...lines.map((l) => estimateTextWidth(l, fontSize)));
  const textWidth = Math.min(longest, container.width);
  const textHeight = lineHeight * lines.length;

  const t = base(
    "text",
    container.x + (container.width - textWidth) / 2,
    container.y + (container.height - textHeight) / 2,
    textWidth,
    textHeight,
    {
      fontSize,
      fontFamily,
      text,
      textAlign: align,
      verticalAlign: "middle",
      containerId: container.id,
      originalText: text, // CRITICAL: must match `text` per SKILL.md
      baseline: lineHeight * 0.85,
      ...opts,
    },
  );
  // Register on the container.
  container.boundElements.push({ id: t.id, type: "text" });
  return t;
}

/**
 * A standalone (unbound) text element.
 */
export function text(x, y, str, opts = {}) {
  const fontSize = opts.fontSize ?? 24;
  const lineHeight = fontSize * 1.25;
  const lines = str.split("\n");
  const width = Math.max(...lines.map((l) => estimateTextWidth(l, fontSize)));
  const height = lineHeight * lines.length;
  return base("text", x, y, width, height, {
    fontSize,
    fontFamily: opts.fontFamily ?? 5,
    text: str,
    textAlign: opts.textAlign ?? "left",
    verticalAlign: "top",
    originalText: str,
    baseline: lineHeight * 0.85,
    ...opts,
  });
}

/**
 * An arrow connecting two elements (or two points).
 * Points are RELATIVE to the arrow's own x/y.
 *
 * If from/to are elements, binds to them (startBinding/endBinding) and
 * registers on their boundElements — so the arrow follows if they move.
 */
export function arrow(from, to, opts = {}) {
  // Anchor at the from-element's center; compute end relative to it.
  const fromCx = from.x + from.width / 2;
  const fromCy = from.y + from.height / 2;
  const toCx = to.x + to.width / 2;
  const toCy = to.y + to.height / 2;

  const a = base("arrow", fromCx, fromCy, Math.abs(toCx - fromCx), Math.abs(toCy - fromCy), {
    points: [
      [0, 0],
      [toCx - fromCx, toCy - fromCy],
    ],
    startBinding: { elementId: from.id, focus: 0, gap: 8 },
    endBinding: { elementId: to.id, focus: 0, gap: 8 },
    startArrowhead: null,
    endArrowhead: "arrow",
    ...opts,
  });
  // width/height must match the point span (absolute).
  a.width = Math.abs(toCx - fromCx) || 1;
  a.height = Math.abs(toCy - fromCy) || 1;

  // Register the arrow on both endpoints so they know about it.
  from.boundElements.push({ id: a.id, type: "arrow" });
  to.boundElements.push({ id: a.id, type: "arrow" });
  return a;
}

/** Snap a coordinate to a 20px grid (keeps generated layouts tidy). */
export const grid = (n) => Math.round(n / 20) * 20;

/** Wrap the produced elements into a full .excalidraw envelope. */
export function wrapScene(elements, name) {
  return {
    type: "excalidraw",
    version: 2,
    source: "excalidraw-local-cli",
    elements,
    appState: {
      viewBackgroundColor: "#ffffff",
      gridSize: null,
      name: name ?? "generated",
    },
    files: {},
  };
}
