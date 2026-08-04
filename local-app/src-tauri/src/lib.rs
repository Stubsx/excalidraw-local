// Excalidraw Local — Tauri backend.
//
// Stage 2: registers the SQL plugin (sqlite) with a migration that creates the
// `scenes` table. The db file lives under the app's AppConfig dir as
// `library.db` (e.g. ~/Library/Application Support/com.excalidraw-local.app/library.db).
//
// Stage 3: spawns the axum IPC server in setup() so the `excal` CLI can trigger
// renders in the webview, and registers the `render_done` callback command.

mod ipc;

use tauri_plugin_sql::{Builder as SqlBuilder, Migration, MigrationKind};

/// The single source-of-truth SQLite connection string.
/// Must EXACTLY match the string used in Database.load() on the frontend —
/// tauri-plugin-sql keys migrations by this string, so a mismatch (e.g.
/// "library.db" vs "sqlite:library.db") silently skips the migration.
const DB_CONN: &str = "sqlite:library.db";

fn scene_migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "create scenes table",
        sql: include_str!("../migrations/001_create_scenes.sql"),
        kind: MigrationKind::Up,
    }]
}

/// Entry point invoked by the thin `main.rs` shim (and by mobile targets).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            SqlBuilder::default()
                .add_migrations(DB_CONN, scene_migrations())
                .build(),
        )
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            ipc::render_done,
            ipc::render_log
        ])
        .setup(|app| {
            // Spawn the local IPC HTTP server (for the `excal` CLI render flow).
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                ipc::start(handle).await;
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
