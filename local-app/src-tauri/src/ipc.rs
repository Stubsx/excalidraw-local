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
use std::io::Write;
use std::sync::Arc;

use axum::{
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode},
    routing::post,
    Json, Router,
};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::net::TcpListener;
use tokio::sync::{oneshot, Mutex};

/// A pending render request, keyed by requestId.
type Pending = Lazy<Mutex<HashMap<String, oneshot::Sender<Result<RenderResult, String>>>>>;
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
    token: String,
}

/// Start the IPC HTTP server. Call from `setup()`.
pub async fn start(app: AppHandle) {
    let token = uuid::Uuid::new_v4().to_string();
    let state = Arc::new(IpcState {
        app: app.clone(),
        token: token.clone(),
    });

    let router = Router::new()
        .route("/render", post(handle_render))
        .route("/notify", post(handle_notify))
        .route("/ping", post(handle_ping))
        .layer(DefaultBodyLimit::max(64 * 1024 * 1024))
        .with_state(state);

    // OS-assigned port on the loopback interface only.
    let listener = match TcpListener::bind("127.0.0.1:0").await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[ipc] failed to bind loopback: {e}");
            return;
        }
    };
    let port = listener.local_addr().map(|a| a.port()).unwrap_or(0);

    // Persist the port so the CLI can discover it.
    if let Err(e) = write_port_file(&app, port, &token) {
        eprintln!("[ipc] failed to write ipc.port: {e}");
    }

    println!("[ipc] listening on 127.0.0.1:{port}");
    axum::serve(listener, router.into_make_service()).await.ok();
}

static READY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
async fn handle_ping() -> Result<&'static str, StatusCode> {
    if READY.load(std::sync::atomic::Ordering::SeqCst) {
        Ok("pong")
    } else {
        Err(StatusCode::SERVICE_UNAVAILABLE)
    }
}
#[tauri::command]
pub fn render_ready() {
    READY.store(true, std::sync::atomic::Ordering::SeqCst);
}

/// CLI write commands (import/mv/rm/put/...) post here after writing SQLite to
/// tell the webview its in-memory library view is stale and should refresh.
/// This is best-effort: the business logic stays in the CLI (direct DB write);
/// the IPC server only forwards the notification.
#[derive(Deserialize)]
struct NotifyRequest {
    /// Kind of change, e.g. "library-changed". Forwarded as the event payload
    /// so the webview can fan out by type later if needed.
    #[serde(rename = "type")]
    kind: String,
}

#[derive(Serialize)]
struct NotifyResponse {
    status: &'static str,
}

async fn handle_notify(
    State(state): State<Arc<IpcState>>,
    headers: HeaderMap,
    Json(req): Json<NotifyRequest>,
) -> Result<Json<NotifyResponse>, StatusCode> {
    authorize(&headers, &state.token)?;
    // Emit a global event the webview listens for; it triggers a sidebar
    // refresh. Ignore emit errors (webview may be unavailable).
    let _ = state.app.emit("library-changed", &req.kind);
    Ok(Json(NotifyResponse { status: "ok" }))
}

async fn handle_render(
    State(state): State<Arc<IpcState>>,
    headers: HeaderMap,
    Json(req): Json<RenderRequest>,
) -> Result<Json<RenderResponse>, StatusCode> {
    authorize(&headers, &state.token)?;
    if req.request_id.is_empty()
        || req.request_id.len() > 128
        || req.format != "png"
        || req.scene_id.is_some() == req.data.is_some()
        || req
            .scale
            .is_some_and(|v| !v.is_finite() || v <= 0.0 || v > 8.0)
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    // Set up the response channel BEFORE emitting, so the webview's reply can't
    // race ahead and find no pending entry.
    let (tx, rx) = oneshot::channel::<Result<RenderResult, String>>();
    {
        let mut pending = PENDING.lock().await;
        if pending.len() >= 8 {
            return Err(StatusCode::TOO_MANY_REQUESTS);
        }
        if pending.contains_key(&req.request_id) {
            return Err(StatusCode::CONFLICT);
        }
        pending.insert(req.request_id.clone(), tx);
    }

    // Tell the webview to render. It will call back via `render_done`.
    if let Err(e) = state.app.emit("render-request", &req) {
        remove_pending(&req.request_id).await;
        return Ok(Json(RenderResponse {
            status: "error",
            result: None,
            error: Some(format!("emit failed: {e}")),
        }));
    }

    // Wait for the webview to deliver the rendered PNG path.
    Ok(
        match tokio::time::timeout(std::time::Duration::from_secs(60), rx).await {
            Ok(Ok(Ok(result))) => Json(RenderResponse {
                status: "success",
                result: Some(result),
                error: None,
            }),
            Ok(Ok(Err(error))) => Json(RenderResponse {
                status: "error",
                result: None,
                error: Some(error),
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
        },
    )
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
    if png.is_empty() || meta.width == 0 || meta.height == 0 || meta.mime_type != "image/png" {
        render_failed(request_id, "渲染没有产生有效图片".into()).await;
        return Err("无效的 PNG".into());
    }
    let tx = PENDING
        .lock()
        .await
        .remove(&request_id)
        .ok_or("请求已经结束")?;
    let output = (|| -> std::io::Result<String> {
        let mut file = tempfile::Builder::new()
            .prefix("excal-render-")
            .suffix(".png")
            .tempfile()?;
        file.write_all(&png)?;
        let (_, path) = file.keep()?;
        Ok(path.to_string_lossy().into_owned())
    })();
    let output = match output {
        Ok(path) => path,
        Err(e) => {
            let message = format!("write png: {e}");
            let _ = tx.send(Err(message.clone()));
            return Err(message);
        }
    };
    let result = RenderResult { output, meta };

    // Deliver to the waiting HTTP handler (if still around).
    if tx.send(Ok(result.clone())).is_err() {
        let _ = std::fs::remove_file(&result.output);
    }
    Ok(result)
}

/// Write the bound port to <AppConfig>/ipc.port so the CLI can find it.
fn write_port_file(app: &AppHandle, port: u16, token: &str) -> std::io::Result<()> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
    std::fs::create_dir_all(&dir)?;
    let path = dir.join("ipc.port");
    use std::io::Write;
    let mut secret = tempfile::NamedTempFile::new_in(&dir)?;
    secret.write_all(token.as_bytes())?;
    secret.persist(dir.join("ipc.token"))?;
    std::fs::write(path, port.to_string())
}

fn authorize(headers: &HeaderMap, token: &str) -> Result<(), StatusCode> {
    if headers.contains_key("origin")
        || headers.get("authorization").and_then(|v| v.to_str().ok())
            != Some(&format!("Bearer {token}"))
    {
        return Err(StatusCode::UNAUTHORIZED);
    }
    Ok(())
}

#[tauri::command]
pub async fn render_failed(request_id: String, error: String) {
    if let Some(tx) = PENDING.lock().await.remove(&request_id) {
        let _ = tx.send(Err(error));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn browser_origins_and_missing_tokens_cannot_mutate_the_library() {
        let mut headers = HeaderMap::new();
        assert_eq!(
            authorize(&headers, "test-secret"),
            Err(StatusCode::UNAUTHORIZED)
        );
        headers.insert("authorization", "Bearer test-secret".parse().unwrap());
        assert!(authorize(&headers, "test-secret").is_ok());
        headers.insert("origin", "https://example.com".parse().unwrap());
        assert_eq!(
            authorize(&headers, "test-secret"),
            Err(StatusCode::UNAUTHORIZED)
        );
    }
    #[tokio::test]
    async fn failed_render_resolves_with_an_error_instead_of_an_empty_success() {
        let (tx, rx) = oneshot::channel();
        PENDING.lock().await.insert("test-failure".into(), tx);
        render_failed("test-failure".into(), "invalid scene".into()).await;
        assert!(matches!(rx.await.unwrap(), Err(message) if message == "invalid scene"));
        assert!(!PENDING.lock().await.contains_key("test-failure"));
    }
}
