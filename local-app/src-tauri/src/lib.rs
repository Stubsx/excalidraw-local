// Excalidraw Local — Tauri backend.
//
// Stage 2: registers the SQL plugin (sqlite) with a migration that creates the
// `scenes` table. The db file lives under the app's AppConfig dir as
// `library.db` (e.g. ~/Library/Application Support/com.excalidraw-local.app/library.db).
//
// Stage 3: spawns the axum IPC server in setup() so the `excal` CLI can trigger
// renders in the webview, and registers the `render_done` callback command.

mod cli_install;
mod files;
mod ipc;
mod updater;

use tauri::{Emitter, Manager};
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .manage(updater::UpdateState::default())
        .on_window_event(|window, event| {
            // Close button → hide the window instead of quitting the app,
            // so the CLI render IPC server stays alive in the background.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                window.hide().ok();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            files::save_scene_file,
            app_exit,
            ipc::render_done,
            ipc::render_failed,
            ipc::render_ready,
            ipc::render_log,
            cli_install::setup_status,
            cli_install::setup_install,
            updater::updater_check,
            updater::updater_download,
            updater::updater_install,
            updater::open_project_page
        ])
        .setup(|app| {
            // Spawn the local IPC HTTP server (for the `excal` CLI render flow).
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                ipc::start(handle).await;
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { api, code, .. } = &event {
                if code.is_none() {
                    api.prevent_exit();
                    let _ = app_handle.emit("app-exit-requested", ());
                }
            }
            // macOS: clicking the dock icon while the window is hidden
            // should bring it back to front (instead of doing nothing).
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(win) = app_handle.get_webview_window("main") {
                    win.show().ok();
                    win.set_focus().ok();
                }
            }
            // Let other events flow through normally.
            let _ = (app_handle, event);
        });
}

#[tauri::command]
fn app_exit(app: tauri::AppHandle) {
    app.exit(0);
}
