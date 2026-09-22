import type { FileSceneData } from "./folderStore";

export function parseScene(text: string): FileSceneData {
  const value = JSON.parse(text);
  const data = Array.isArray(value) ? { elements: value } : value;
  if (!data || typeof data !== "object" || !Array.isArray(data.elements)) {
    throw new Error("文件不是有效的 Excalidraw 图：缺少 elements 数组。");
  }
  if (data.type && data.type !== "excalidraw") {
    throw new Error("不支持的文件类型。");
  }
  if (
    data.elements.some(
      (e: unknown) =>
        !e || typeof e !== "object" || !("type" in e) || !("id" in e),
    )
  ) {
    throw new Error("图中存在无效元素。");
  }
  for (const key of ["appState", "files"]) {
    if (
      data[key] != null &&
      (typeof data[key] !== "object" || Array.isArray(data[key]))
    ) {
      throw new Error(`无效的 ${key}。`);
    }
  }
  return {
    type: "excalidraw",
    version: 2,
    elements: data.elements,
    appState: data.appState ?? {},
    files: data.files ?? {},
  };
}
