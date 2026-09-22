/** Refuse ambiguous names; never silently modify the newest match. */
export function findScene(db, query, includeDeleted = false) {
  if (!query?.trim()) throw new Error("Scene id or name cannot be empty");
  const where = includeDeleted ? "1=1" : "is_deleted = 0";
  const exactId = db
    .prepare(`SELECT * FROM scenes WHERE id = ? AND ${where}`)
    .get(query);
  if (exactId) return exactId;
  let rows = db
    .prepare(`SELECT * FROM scenes WHERE name = ? AND ${where} LIMIT 2`)
    .all(query);
  if (!rows.length)
    rows = db
      .prepare(
        `SELECT * FROM scenes WHERE instr(name, ?) > 0 AND ${where} LIMIT 2`,
      )
      .all(query);
  if (rows.length > 1)
    throw new Error(
      `Multiple scenes match "${query}". Use local ls to find the exact scene id.`,
    );
  return rows[0];
}
export function parseScene(raw) {
  const parsed = JSON.parse(raw);
  const value = Array.isArray(parsed) ? { elements: parsed } : parsed;
  if (!value || typeof value !== "object" || !Array.isArray(value.elements))
    throw new Error("Invalid Excalidraw scene: missing elements array");
  if (value.type && value.type !== "excalidraw")
    throw new Error("Unsupported scene type");
  if (
    value.elements.some(
      (e) =>
        !e ||
        typeof e !== "object" ||
        typeof e.id !== "string" ||
        typeof e.type !== "string",
    )
  )
    throw new Error("Invalid scene element");
  for (const key of ["appState", "files"])
    if (
      value[key] != null &&
      (typeof value[key] !== "object" || Array.isArray(value[key]))
    )
      throw new Error(`Invalid ${key}`);
  return {
    elements: value.elements,
    appState: value.appState ?? {},
    files: value.files ?? {},
  };
}
