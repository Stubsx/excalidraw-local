# Excalidraw Local

Local-first Excalidraw desktop app with file management and an Agent-facing CLI.
Built on top of the upstream [excalidraw](https://github.com/excalidraw/excalidraw)
editor (MIT), wrapped in a Tauri 2 shell with SQLite persistence and an IPC
render channel.

## Features (v0.2)

- **GUI**: full Excalidraw editor in a desktop window.
- **Multi-tab**: open multiple scenes simultaneously in tabs; switch, close,
  and the session restores on next launch.
- **Sidebar file manager**: browse all scenes with thumbnails, search by name,
  star/unstar, delete, create new — all in-app.
- **Folder browsing**: open any local folder and edit `.excalidraw` files
  *in place* on disk (not copied into the library). Switch between "资料库"
  (SQLite) and "文件夹" (disk) views.
- **Thumbnails**: each scene auto-generates a small PNG preview on edit,
  shown in the sidebar.
- **Autosave**: every change is debounced (500ms) — library tabs write to
  SQLite, folder tabs write back to the `.excalidraw` file on disk.
- **CLI**: full library management (`ls`/`get`/`import`/`mv`/`rm`/`gen`) +
  `render` for Agent-driven rendering.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  excal CLI (Node)                                           │
│  reads .excalidraw → POST /render {requestId, data}         │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP (127.0.0.1:<random port>)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Tauri app (Rust)                                           │
│  axum server (port in <AppConfig>/ipc.port)                 │
│  → app.emit("render-request")  → oneshot await              │
└──────────────────────────┬──────────────────────────────────┘
                           │ Tauri event
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  WebView (React + <Excalidraw />)                           │
│  listen("render-request") → exportToBlob() → invoke(        │
│    "render_done", {png, meta})                              │
│                                                             │
│  onChange → debounced → SQLite (library.db)                 │
└─────────────────────────────────────────────────────────────┘
```

Two independent capability tiers for the CLI:

| CLI command              | Needs app running? | Reads/writes |
|--------------------------|--------------------|--------------|
| `ls`                     | ❌ no              | SQLite (read) |
| `get`                    | ❌ no              | SQLite (read) |
| `import`                 | ❌ no              | SQLite (write) |
| `mv` (rename / star)     | ❌ no              | SQLite (write) |
| `rm` (delete)            | ❌ no              | SQLite (write) |
| `gen` (mindmap / tree)   | ❌ no              | pure compute / SQLite |
| `render`                 | ✅ yes (webview)   | SQLite or inlined data |

Library commands read/write the **same `library.db`** the GUI uses (SQLite WAL
mode supports concurrent access — you can run CLI commands while the app is
open). `render` is the only command that needs the app, because the actual
PNG rasterization happens in the webview.

## Prerequisites

- Node 22.13+, Yarn 1.x (the monorepo pins `yarn@1.22.22`)
- Rust toolchain (`rustup`) with the `aarch64-apple-darwin` (or your platform)
  target
- Tauri CLI 2.x (`cargo install tauri-cli --version "^2" --locked`)

## Running in development

From the **repository root** (`excalidraw-source/`):

```bash
yarn install                       # one-time: links local-app workspace
cd local-app
cargo tauri dev                    # builds Rust + starts Vite + opens window
```

The first Rust build takes a few minutes; subsequent rebuilds are incremental
(~2–6s).

## Using the GUI

The app has a left sidebar with two views:

- **资料库 (Library)**: scenes stored in the local SQLite database. Create new
  scenes with `+`, search, star, delete — all managed internally.
- **文件夹 (Folder)**: `.excalidraw` files on disk, edited in place.
  1. Click the "文件夹" tab at the top of the sidebar.
  2. Click "📂 打开文件夹" and pick a folder (e.g. `~/Desktop/excalidraw`).
  3. All `.excalidraw` files in that folder are listed; click one to open it.
  4. Edits autosave (500ms debounce) **back to the file on disk** — not copied
     into the library. Your existing files stay where they are.

Both library and folder files open as tabs, so you can mix them freely.

## Using the CLI

### Library management (no app needed)

```bash
CLI="local-app/cli/bin/excal.mjs"

# Import a .excalidraw file into the library (returns a sceneId)
node $CLI local import path/to/scene.excalidraw --name "架构图" --starred

# List scenes (table or json)
node $CLI local ls --format table
node $CLI local ls --starred

# Export a scene back to a .excalidraw file (by id or name substring)
node $CLI local get "架构图" -o out.excalidraw

# Rename or star/unstar
node $CLI local mv "架构图" --name "新架构图"
node $CLI local mv "架构图" --star

# Remove (soft-delete by default; --purge erases the row)
node $CLI local rm old-draft
node $CLI local rm old-draft --purge
```

### Generation (declarative → diagram; no app needed)

`gen` turns a small JSON spec into a fully-laid-out `.excalidraw` scene,
handling all field hygiene (ids, seeds, versionNonces, text-width estimation,
container/text pairing, arrow binding) so agents never touch raw elements.

```bash
# Mindmap: root + branches with children, radiating left/right
node $CLI local gen --json '{
  "title": "架构",
  "root": {"label": "Excalidraw Local", "color": "#4d96ff"},
  "branches": [
    {"label": "GUI",   "children": ["多 Tab", "文件管理"]},
    {"label": "CLI",   "children": ["render", "gen", "ls/get/mv"]},
    {"label": "内核",  "children": ["React 组件", "exportToBlob"]}
  ]
}' -o arch.excalidraw

# Tree: left→right hierarchy
node $CLI local gen --spec-file org.json --template tree --import --name "组织架构"

# Templates: mindmap | tree. --import writes straight into the library.
```

### Rendering (automatically starts the app)

```bash
# Render a .excalidraw file to PNG (automatically starts the app)
node $CLI local render path/to/scene.excalidraw -o out.png
node $CLI local render scene.excalidraw --scale 2

# Render a library scene by id (no file path needed)
node $CLI local render --scene-id <uuid> -o out.png
```

### Agent workflow: import → render

```bash
# 1. Agent writes/imports a scene, gets a sceneId back
node $CLI local import draft.excalidraw --name "v1"
# → {"data":{"sceneId":"3e8d222a-...", ...}}

# 2. Agent iterates on the .excalidraw file, then renders to verify
node $CLI local render draft.excalidraw -o check.png
# → {"data":{"output":"check.png","width":2243,...,"elapsedMs":215}}

# 3. Or render the library copy directly by id
node $CLI local render --scene-id 3e8d222a-... -o check.png
```

### Output contract

Every command prints a JSON status envelope as the **last line of stdout**:

```json
{"status":"success","command":"render","message":"rendered ... -> png",
 "data":{"output":"/abs/out.png","format":"png","width":2243,"height":2132,
         "mimeType":"image/png","elapsedMs":216},
 "warnings":[],"errors":null,"meta":{"appVersion":"0.2.0","time":"..."}}
```

`render` starts the installed App and waits for its render interface. If startup
fails, it returns `EAPPNOTRUNNING`. Library commands fail with `ENODB` if the db hasn't been initialized (run the app once).

## Where data lives

| Artifact | Path |
|---|---|
| SQLite library | `~/Library/Application Support/com.excalidraw-local.app/library.db` (+ `-wal`, `-shm`) |
| IPC port file | `~/Library/Application Support/com.excalidraw-local.app/ipc.port` |
| Rendered PNGs (temp) | `$TMPDIR/excal-render-*.png` |

Use SQLite’s backup API (or quit the App and all CLI processes before copying)
to back up the library consistently, including any committed WAL data.

## Project layout

```
local-app/
├── index.html              # minimal host page (sets EXCALIDRAW_ASSET_PATH)
├── vite.config.ts          # aliases @excalidraw/* → ../packages/* (source)
├── tsconfig.json
├── src/
│   ├── main.tsx            # App: layout (Sidebar + TabBar + EditorArea)
│   ├── tabs.ts             # useTabs: multi-tab state + session restore
│   ├── folderStore.ts      # disk reads and atomic native writes
│   ├── styles.ts           # sidebar/tab-bar inline styles
│   ├── components/
│   │   ├── Sidebar.tsx     # file list: search / star / delete / open
│   │   ├── TabBar.tsx      # open-scene tabs with dirty markers
│   │   └── EditorPane.tsx  # one <Excalidraw /> + autosave + thumbnail
│   ├── db/
│   │   ├── types.ts        # SavedScene model
│   │   └── sceneStore.ts   # SQLite adapter (query/upsert/thumbnail/session…)
│   └── render/
│       └── ipcListener.ts  # listen("render-request") → exportToBlob → render_done
├── src-tauri/
│   ├── src/{lib,main,ipc}.rs
│   ├── migrations/001_create_scenes.sql
│   └── capabilities/default.json
└── cli/
    ├── bin/excal.mjs        # entry: domain/command dispatch
    ├── commands/            # render | ls | get | import | mv | rm | gen
    ├── generators/          # mindmap | tree (spec → elements)
    └── lib/                 # db.mjs | ipc.mjs | envelope.mjs | elements.mjs
```

## Not yet implemented (see PRD §6 roadmap)

Tags, full-text search within drawings, version history, and more `gen`
templates (flowchart/grid).

## v0.2 desktop maintenance

Settings now installs the bundled drawing skill into selected AI clients, with an
included Node runtime and optional terminal configuration. See
[release instructions](docs/RELEASING.md) for the standardized signed/notarized
DMG pipeline and preview builds. The App supports macOS 12.0+.

`render` produces a PNG without changing the library; pass `--save` explicitly
to save by name. Ambiguous scene names are rejected; use scene IDs for writes.

Validation: `yarn workspace excalidraw-local typecheck`, `test`, `test:cli`, and
`cargo test --locked --manifest-path local-app/src-tauri/Cargo.toml`.
