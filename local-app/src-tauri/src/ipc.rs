//! Local IPC server: lets an external process (the `excal` CLI) trigger a
//! render inside the running app's webview.
//!
//! Flow:
//!   CLI --HTTP POST /render {requestId, sceneId|file}--> axum handler
//!   handler: app.emit("render-request", payload) --> webview
//!   webview: exportToBlob() --> invoke("render_done", {requestId, png, meta})
//!   render_done command: resolves the oneshot for requestId --> HTTP response
//!
//! The server binds 127.0.0.1:0 (OS-assigned port) and writes the port to
//! `<AppConfig>/ipc.port` so the CLI can discover it.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use axum::{extract::State, routing::post, Json, Router};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{oneshot, Mutex};
use tokio::net::TcpListener;

/// A pending render request, keyed by requestId.
type Pending = Lazy<Mutex<HashMap<String, oneshot::Sender<RenderResult>>>>;
static PENDING: Pending = Lazy::new(|| Mutex::new(HashMap::new()));

/// What the webview hands back after exportToBlob succeeds.
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RenderMeta {
    pub width: u32,
    pub height: u32,
    pub mime_type: String,
}

/// Result delivered from the webview render_done command to the HTTP handler.
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct RenderResult {
    /// Absolute path the PNG was written to.
    pub output: String,
    pub meta: RenderMeta,
}

/// CLI request body: render a scene.
///
/// The CLI picks ONE source:
///   - `sceneId`: render a scene stored in the local library (loaded by webview
///     via the SQL plugin), OR
///   - `data`: the raw scene JSON (CLI already read the .excalidraw file and
///     inlined it). Preferred for arbitrary files — keeps the webview free of
///     filesystem access.
#[derive(Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
struct RenderRequest {
    request_id: String,
    #[serde(default)]
    scene_id: Option<String>,
    /// Inlined scene JSON (the full .excalidraw file contents). Mutually
    /// exclusive with sceneId.
    #[serde(default)]
    data: Option<String>,
    /// Library name to save the rendered scene under (CLI render auto-import).
    /// Only used together with `data`. The webview upserts the scene by this
    /// name so it shows up in the sidebar. Omitted for the sceneId path.
    #[serde(default)]
    name: Option<String>,
    #[serde(default = "default_format")]
    format: String,
    #[serde(default)]
    scale: Option<f32>,
}

fn default_format() -> String {
    "png".to_string()
}

#[derive(Serialize)]
struct RenderResponse {
    status: &'static str,
    #[serde(flatten)]
    result: Option<RenderResult>,
    error: Option<String>,
}

/// Shared state carried into axum handlers: the Tauri app handle (to emit).
struct IpcState {
    app: AppHandle,
}

/// Start the IPC HTTP server. Call from `setup()`.
pub async fn start(app: AppHandle) {
    let state = Arc::new(IpcState { app: app.clone() });

    let router = Router::new()
        .route("/render", post(handle_render))
        .route("/ping", post(handle_ping))
        .with_state(state);

    // OS-assigned port on the loopback interface only.
    let listener = match TcpListener::bind("127.0.0.1:0").await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[ipc] failed to bind loopback: {e}");
            return;
        }
    };
    let port = listener
        .local_addr()
        .map(|a| a.port())
        .unwrap_or(0);

    // Persist the port so the CLI can discover it.
    if let Err(e) = write_port_file(&app, port) {
        eprintln!("[ipc] failed to write ipc.port: {e}");
    }

    println!("[ipc] listening on 127.0.0.1:{port}");
    axum::serve(listener, router.into_make_service())
        .await
        .ok();
}

async fn handle_ping() -> &'static str {
    "pong"
}

async fn handle_render(
    State(state): State<Arc<IpcState>>,
    Json(req): Json<RenderRequest>,
) -> Json<RenderResponse> {
    // Set up the response channel BEFORE emitting, so the webview's reply can't
    // race ahead and find no pending entry.
    let (tx, rx) = oneshot::channel::<RenderResult>();
    {
        let mut pending = PENDING.lock().await;
        pending.insert(req.request_id.clone(), tx);
    }

    // Tell the webview to render. It will call back via `render_done`.
    if let Err(e) = state.app.emit("render-request", &req) {
        remove_pending(&req.request_id).await;
        return Json(RenderResponse {
            status: "error",
            result: None,
            error: Some(format!("emit failed: {e}")),
        });
    }

    // Wait for the webview to deliver the rendered PNG path.
    match tokio::time::timeout(std::time::Duration::from_secs(60), rx).await {
        Ok(Ok(result)) => Json(RenderResponse {
            status: "success",
            result: Some(result),
            error: None,
        }),
        Ok(Err(_)) => Json(RenderResponse {
            status: "error",
            result: None,
            error: Some("render channel closed".to_string()),
        }),
        Err(_) => {
            remove_pending(&req.request_id).await;
            Json(RenderResponse {
                status: "error",
                result: None,
                error: Some("render timed out (60s)".to_string()),
            })
        }
    }
}

async fn remove_pending(id: &str) {
    PENDING.lock().await.remove(id);
}

/// Tauri command: called by the webview once exportToBlob is done.
/// Writes the PNG bytes to a temp file and resolves the pending HTTP request.
/// Diagnostic command: webview logs here so we can see them in the Rust console
/// (Tauri dev doesn't forward webview console.* to the terminal by default).
#[tauri::command]
pub fn render_log(msg: String) {
    eprintln!("[webview] {msg}");
}

#[tauri::command]
pub async fn render_done(
    request_id: String,
    png: Vec<u8>,
    meta: RenderMeta,
) -> Result<RenderResult, String> {
    let out_path = temp_path();
    std::fs::write(&out_path, &png).map_err(|e| format!("write png: {e}"))?;

    let result = RenderResult {
        output: out_path,
        meta,
    };

    // Deliver to the waiting HTTP handler (if still around).
    let tx = PENDING.lock().await.remove(&request_id);
    if let Some(tx) = tx {
        let _ = tx.send(result.clone());
    }
    Ok(result)
}

fn temp_path() -> String {
    let id = uuid_v4();
    // /tmp on macOS; on other platforms std::env::temp_dir is still fine.
    let mut p: PathBuf = std::env::temp_dir();
    p.push(format!("excal-render-{id}.png"));
    p.to_string_lossy().into_owned()
}

/// Minimal v4 uuid without pulling in a uuid crate dependency.
fn uuid_v4() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{nanos:032x}")
}

/// Write the bound port to <AppConfig>/ipc.port so the CLI can find it.
fn write_port_file(app: &AppHandle, port: u16) -> std::io::Result<()> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
    std::fs::create_dir_all(&dir)?;
    let path = dir.join("ipc.port");
    std::fs::write(path, port.to_string())
}
