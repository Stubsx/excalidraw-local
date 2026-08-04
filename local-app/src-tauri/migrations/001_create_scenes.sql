-- scenes: one row per saved Excalidraw scene (the local "library").
--
-- elements/appState/files are stored as JSON columns (serialized via the
-- upstream serializeAsJSON helper, which already cleans appState for export).
-- thumbnail is a dataURL produced by exportToBlob, kept in its own column so
-- it can be lazy-loaded by the file-list UI in a later stage.
CREATE TABLE IF NOT EXISTS scenes (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL DEFAULT '未命名',
    elements_json TEXT NOT NULL DEFAULT '[]',
    app_state_json TEXT NOT NULL DEFAULT '{}',
    files_json    TEXT NOT NULL DEFAULT '{}',
    thumbnail     TEXT,
    starred       INTEGER NOT NULL DEFAULT 0,
    is_deleted    INTEGER NOT NULL DEFAULT 0,
    deleted_at    INTEGER,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scenes_updated ON scenes(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_scenes_starred ON scenes(starred) WHERE starred = 1 AND is_deleted = 0;

-- A single "active scene" pointer so the app knows which row the current
-- editor session is editing (MVP: one scene at a time; multi-tab comes later).
CREATE TABLE IF NOT EXISTS app_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
