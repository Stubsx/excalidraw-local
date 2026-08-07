//! CLI install: exposes commands for the Settings panel to install/uninstall
//! the bundled `excal` CLI as a symlink on the user's PATH, plus a one-click
//! Node.js installer (downloads the official .pkg and runs it with admin auth).
//!
//! The CLI ships inside the app bundle under `Contents/Resources/cli/` (macOS),
//! configured via `tauri.conf.json` `bundle.resources`. It is self-contained
//! (zero npm deps, only `node:*` builtins) but requires Node ≥ 22.5 on the host
//! because of `node:sqlite`. When Node is missing or too old, the Settings panel
//! offers a one-click install that downloads the official .pkg and runs the
//! system installer via `osascript ... with administrator privileges` — the user
//! only has to type their admin password once.
//!
//! CLI install target selection (in priority order):
//!   1. `~/.local/bin` — user-level, no sudo, conventional. Created if missing.
//!   2. `/usr/local/bin` — system-wide; if not user-writable, escalate via
//!      `osascript ... with administrator privileges` (macOS auth prompt).
//!
//! All commands return serializable structs (serde) so the webview can render
//! status cleanly. Errors are returned as `Result<_, String>` per Tauri convention.
//!
//! Zero extra crate deps: Node download uses the macOS-bundled `curl`, and the
//! privileged install uses `osascript` + `installer` — all via
//! `std::process::Command`, mirroring the rest of this module.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

/// Minimum Node major version required by the CLI (`node:sqlite` needs ≥ 22.5).
const MIN_NODE_MAJOR: u32 = 22;

/// The CLI entry script, relative to the bundle's resource dir.
const CLI_ENTRY_REL: &str = "cli/bin/excal.mjs";

/// The symlink name placed on PATH.
const LINK_NAME: &str = "excal";

// ---------------------------------------------------------------------------
// Node install constants
// ---------------------------------------------------------------------------

/// Where the Node.js release index lives (JSON listing every version).
const NODE_INDEX_URL: &str = "https://nodejs.org/dist/index.json";

/// Major version we want (must match MIN_NODE_MAJOR). We install the latest
/// LTS on this line.
const NODE_WANT_MAJOR: u32 = 22;

/// Fallback version if the index.json lookup fails (network blip etc.).
/// Pinned to a known-good v22 LTS; bumped manually when stale.
const NODE_FALLBACK_VERSION: &str = "v22.23.2";

/// Event name used to stream install progress to the webview.
const NODE_PROGRESS_EVENT: &str = "node-install-progress";

// ---------------------------------------------------------------------------
// response types
// ---------------------------------------------------------------------------

/// Full status snapshot shown in the Settings panel.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliStatus {
    /// Absolute path to the bundled CLI entry inside the .app, or null if the
    /// resources weren't bundled (e.g. running `cargo run` without resources).
    pub bundled_path: Option<String>,
    /// True if `excal` resolves on the current PATH.
    pub installed: bool,
    /// Where the existing `excal` on PATH points (canonicalized target), if any.
    pub installed_path: Option<String>,
    /// True if `node` is on PATH.
    pub node_present: bool,
    /// e.g. "v22.23.1" — null if node missing.
    pub node_version: Option<String>,
    /// True if node is present AND >= MIN_NODE_MAJOR.
    pub node_ok: bool,
    /// The dir we'd install into by default (highest-priority writable one).
    pub recommended_dir: Option<String>,
    /// Whether `recommended_dir` is already on the user's PATH.
    /// (Install can succeed but `excal` won't resolve until PATH is updated.)
    pub recommended_dir_on_path: bool,
}

/// Outcome of an install attempt.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub success: bool,
    /// Where the symlink ended up.
    pub link_path: Option<String>,
    /// The target the link points to.
    pub target: Option<String>,
    /// True if install succeeded but the dir isn't on PATH — UI should prompt
    /// the user to add it to their shell rc.
    pub needs_path_hint: bool,
    /// Human-readable message for the UI.
    pub message: String,
}

/// Resolved Node version (from nodejs.org/dist/index.json), for the UI to show
/// "Install Node v22.x.x (LTS)" before the user clicks.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeVersionInfo {
    /// e.g. "v22.23.2"
    pub version: String,
    /// e.g. "Jod" (LTS codename), or null if it's a current/non-LTS release.
    pub lts: Option<String>,
    /// True if this came from the fallback constant rather than a live lookup.
    pub is_fallback: bool,
}

/// Progress event streamed to the webview during `cli_install_node`.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NodeInstallProgress {
    /// One of: "resolving" | "downloading" | "installing" | "done" | "error".
    pub stage: String,
    /// 0-100 during "downloading"; null for other stages.
    pub percent: Option<u32>,
    /// Human-readable Chinese message for the UI.
    pub message: String,
}

/// Outcome of `cli_install_node`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeInstallResult {
    pub success: bool,
    /// Installed version string (e.g. "v22.23.2") on success.
    pub version: Option<String>,
    pub message: String,
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/// Resolve the bundled CLI entry path. In a real bundle this is
/// `<Resources>/cli/bin/excal.mjs`. Returns None if absent (dev mode without
/// resources, or broken bundle).
fn bundled_cli_path(app: &AppHandle) -> Option<PathBuf> {
    let res_dir = app.path().resource_dir().ok()?;
    let p = res_dir.join(CLI_ENTRY_REL);
    if p.exists() {
        Some(p)
    } else {
        None
    }
}

/// Run `node --version` and return the raw string (e.g. "v22.23.1") if node is
/// on PATH. Swallows all errors (node just "isn't present").
fn detect_node_version() -> Option<String> {
    let out = Command::new("node")
        .arg("--version")
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if v.starts_with('v') {
        Some(v)
    } else {
        None
    }
}

/// Parse "v22.23.1" → major version. Returns None on malformed input.
fn parse_major(raw: &str) -> Option<u32> {
    let trimmed = raw.trim_start_matches('v');
    trimmed.split('.').next()?.parse::<u32>().ok()
}

/// Look up `excal` on PATH (like `which`). Returns the resolved path if found.
fn which_excal() -> Option<PathBuf> {
    let out = Command::new("which")
        .arg(LINK_NAME)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if p.is_empty() {
        None
    } else {
        Some(PathBuf::from(p))
    }
}

/// Is `dir` on the user's `$PATH`?
fn dir_on_path(dir: &Path) -> bool {
    let Some(paths) = std::env::var_os("PATH") else {
        return false;
    };
    std::env::split_paths(&paths).any(|p| p == dir)
}

/// Candidate install dirs in priority order.
fn candidate_dirs() -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Some(home) = dirs::home_dir() {
        v.push(home.join(".local").join("bin"));
    }
    v.push(PathBuf::from("/usr/local/bin"));
    v
}

/// Pick the best dir to install into: the first candidate whose parent exists
/// and is writable, falling back to the first candidate regardless.
///
/// "Writable" is tested by trying to create the dir (idempotent) and then
/// write+delete a probe file — this correctly handles /usr/local/bin which is
/// usually not user-writable on macOS.
fn recommended_dir() -> (PathBuf, bool) {
    for d in candidate_dirs() {
        // Ensure the dir exists (best effort). /usr/local/bin always exists;
        // ~/.local/bin may not.
        let _ = fs::create_dir_all(&d);
        if is_writable(&d) {
            return (d, true);
        }
    }
    // Nothing writable — return the first candidate anyway so the UI can offer
    // a sudo install.
    (candidate_dirs()[0].clone(), false)
}

/// True if we can create+delete a file in `dir`.
fn is_writable(dir: &Path) -> bool {
    if !dir.exists() {
        return false;
    }
    let probe = dir.join(".excal_write_probe");
    match fs::write(&probe, b"x") {
        Ok(_) => {
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// Create a symlink, replacing any existing file/symlink at `link`.
/// Returns Ok(()) on success or Err(message).
fn force_symlink(target: &Path, link: &Path) -> Result<(), String> {
    // Remove anything already at the link path (file, symlink, or broken link).
    if link.exists() || link.is_symlink() {
        fs::remove_file(link)
            .map_err(|e| format!("无法移除旧的 {link:?}: {e}"))?;
    }
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(target, link)
            .map_err(|e| format!("创建软链 {link:?} → {target:?} 失败: {e}"))?;
    }
    #[cfg(not(unix))]
    {
        return Err("仅支持 Unix（macOS/Linux）".into());
    }
    Ok(())
}

/// Escalate a symlink creation via macOS `osascript`, prompting the user for
/// their admin password. Used as a fallback when the target dir isn't
/// user-writable (typically /usr/local/bin).
#[cfg(target_os = "macos")]
fn sudo_symlink(target: &Path, link: &Path) -> Result<(), String> {
    use std::path::absolute;
    let t = absolute(target).map_err(|e| format!("解析绝对路径失败: {e}"))?;
    let l = absolute(link).map_err(|e| format!("解析绝对路径失败: {e}"))?;
    // rm -f the link then ln -s. Quote paths defensively.
    let script = format!(
        "rm -f {l} && ln -s {t} {l}",
        l = shlex_quote(&l.to_string_lossy()),
        t = shlex_quote(&t.to_string_lossy()),
    );
    let apple = format!(
        "do shell script \"{script}\" with administrator privileges",
        script = script.replace('\\', "\\\\").replace('"', "\\\""),
    );
    let out = Command::new("osascript")
        .args(["-e", &apple])
        .output()
        .map_err(|e| format!("启动 osascript 失败: {e}"))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!("授权安装失败: {}", stderr.trim()));
    }
    Ok(())
}

/// Minimal POSIX shell quoting (single quotes around the value, escape inner).
fn shlex_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Snapshot of the CLI install state, for rendering the Settings panel.
#[tauri::command]
pub fn cli_status(app: AppHandle) -> CliStatus {
    let bundled_path = bundled_cli_path(&app)
        .map(|p| p.to_string_lossy().into_owned());

    let (installed_path, installed) = match which_excal() {
        Some(p) => {
            // Canonicalize so the UI shows the real target, not just the link.
            let canon = fs::canonicalize(&p).unwrap_or(p);
            (Some(canon.to_string_lossy().into_owned()), true)
        }
        None => (None, false),
    };

    let node_version = detect_node_version();
    let node_present = node_version.is_some();
    let node_ok = node_version
        .as_deref()
        .and_then(parse_major)
        .map(|maj| maj >= MIN_NODE_MAJOR)
        .unwrap_or(false);

    let (rec, _writable) = recommended_dir();
    let recommended_dir = Some(rec.to_string_lossy().into_owned());
    let recommended_dir_on_path = dir_on_path(&rec);

    CliStatus {
        bundled_path,
        installed,
        installed_path,
        node_present,
        node_version,
        node_ok,
        recommended_dir,
        recommended_dir_on_path,
    }
}

/// Install (or reinstall) the `excal` symlink.
///
/// `target_dir` overrides the recommended dir; if None, the recommended dir is
/// used (and sudo-escalated when it isn't user-writable).
#[tauri::command]
pub fn cli_install(app: AppHandle, target_dir: Option<String>) -> Result<InstallResult, String> {
    let target_entry = bundled_cli_path(&app).ok_or_else(|| {
        "未在 app bundle 内找到 CLI 资源（cli/bin/excal.mjs）。请用正式构建的 app，不要用 cargo run。".to_string()
    })?;

    let dir = match target_dir {
        Some(d) => PathBuf::from(d),
        None => recommended_dir().0,
    };
    // Ensure the dir exists (esp. for ~/.local/bin on first use).
    let _ = fs::create_dir_all(&dir);

    let link = dir.join(LINK_NAME);

    // Try a direct symlink first (works for user-writable dirs).
    if let Err(e) = force_symlink(&target_entry, &link) {
        // Direct failed — try sudo on macOS if the dir isn't writable.
        #[cfg(target_os = "macos")]
        {
            if !is_writable(&dir) {
                sudo_symlink(&target_entry, &link)?;
            } else {
                return Err(e);
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            return Err(e);
        }
    }

    let on_path = dir_on_path(&dir);
    Ok(InstallResult {
        success: true,
        link_path: Some(link.to_string_lossy().into_owned()),
        target: Some(target_entry.to_string_lossy().into_owned()),
        needs_path_hint: !on_path,
        message: if on_path {
            "已安装。".into()
        } else {
            format!(
                "已安装到 {}，但该目录不在 PATH 中，请按提示加入。",
                dir.display()
            )
        },
    })
}

/// Remove the `excal` symlink from PATH (only if it's a symlink, never a real
/// file the user might have created).
#[tauri::command]
pub fn cli_uninstall() -> Result<InstallResult, String> {
    let Some(found) = which_excal() else {
        return Err("未找到 excal（可能本来就没装）".into());
    };
    // Safety: only remove if it's a symlink, not a regular file.
    let meta = fs::symlink_metadata(&found).map_err(|e| format!("读取 {found:?} 元数据失败: {e}"))?;
    if !meta.file_type().is_symlink() {
        return Err(format!(
            "{found:?} 不是软链，可能是你自己装的脚本，已跳过删除以免误删。"
        ));
    }
    fs::remove_file(&found).map_err(|e| format!("删除 {found:?} 失败: {e}"))?;
    Ok(InstallResult {
        success: true,
        link_path: None,
        target: None,
        needs_path_hint: false,
        message: format!("已卸载 {}", found.display()),
    })
}

// ===========================================================================
// Node.js install (one-click, via official .pkg)
// ===========================================================================

/// Emit a progress event to the webview. Best-effort: a failed emit is logged
/// to stderr but never breaks the install.
fn emit_progress(app: &AppHandle, stage: &str, percent: Option<u32>, message: &str) {
    let payload = NodeInstallProgress {
        stage: stage.to_string(),
        percent,
        message: message.to_string(),
    };
    if let Err(e) = app.emit(NODE_PROGRESS_EVENT, payload) {
        eprintln!("[cli_install] emit progress failed: {e}");
    }
}

/// Fetch the Node release index via the macOS-bundled `curl` and parse the
/// latest v22 LTS version out of it. Returns the fallback version on any error.
///
/// We avoid adding `reqwest`/`ureq` to keep the binary lean and the build
/// fast — `curl` is present on every macOS install.
fn resolve_latest_node_version() -> NodeVersionInfo {
    let parsed = (|| -> Option<(String, Option<String>)> {
        let out = Command::new("curl")
            .args(["-fsSL", "--max-time", "15", NODE_INDEX_URL])
            .output()
            .ok()?;
        if !out.status.success() {
            return None;
        }
        let body = String::from_utf8_lossy(&out.stdout);
        let parsed_json: serde_json::Value = serde_json::from_str(body.trim()).ok()?;
        let arr = parsed_json.as_array()?;
        // index.json is newest-first. Find the first entry whose major == ours
        // and that is LTS (lts != false). Some entries use `lts: false`.
        for entry in arr {
            let ver = entry.get("version")?.as_str()?;
            if !ver.starts_with(&format!("v{}.", NODE_WANT_MAJOR)) {
                continue;
            }
            let lts = entry.get("lts").and_then(|v| v.as_str()).map(String::from);
            if lts.is_none() {
                continue; // `lts: false` → skip, we want an LTS line
            }
            return Some((ver.to_string(), lts));
        }
        None
    })();

    match parsed {
        Some((version, lts)) => NodeVersionInfo {
            version,
            lts,
            is_fallback: false,
        },
        None => NodeVersionInfo {
            version: NODE_FALLBACK_VERSION.to_string(),
            lts: None,
            is_fallback: true,
        },
    }
}

/// Build the official .pkg download URL for a version, e.g.
/// `https://nodejs.org/dist/v22.23.2/node-v22.23.2.pkg`.
fn pkg_url(version: &str) -> String {
    format!("https://nodejs.org/dist/{version}/node-{version}.pkg")
}

/// Resolve a temp path for the downloaded .pkg. We reuse a stable filename so
/// repeated attempts don't litter temp files.
fn pkg_download_path() -> PathBuf {
    std::env::temp_dir().join("excal-node-install.pkg")
}

/// Download `url` to `dest` via `curl`, emitting download progress events.
///
/// Strategy: run curl with `-o dest`, polling the growing file size every
/// ~300ms and comparing against the `Content-Length` (fetched separately with
/// a tiny HEAD-style request) to compute a percentage. This avoids parsing
/// curl's progress-bar carriage-return output (fragile across curl versions).
fn download_with_progress(
    app: &AppHandle,
    url: &str,
    dest: &Path,
) -> Result<(), String> {
    // 1. Get total size via a separate curl call (follow redirects, headers).
    let total = total_size(url).unwrap_or(0);

    // 2. Spawn curl in the background (it blocks until the file is written).
    let dest_str = dest.to_string_lossy().to_string();
    let mut curl = Command::new("curl")
        .args([
            "-fSL",          // fail on HTTP error, follow redirects, show errors
            "--retry", "2",  // a couple of automatic retries on transient errors
            "--connect-timeout", "20",
            "-o", &dest_str,
            url,
        ])
        // Detach stdout/stderr so a progress bar can't deadlock our pipe.
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("启动 curl 失败: {e}"))?;

    // 3. Poll file size until curl exits, emitting progress every ~300ms.
    let start = std::time::Instant::now();
    loop {
        match curl.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    // Clean up a partial file so a retry starts fresh.
                    let _ = fs::remove_file(dest);
                    return Err(format!("下载失败（curl 退出码 {}）", status.code().unwrap_or(-1)));
                }
                // Final 100% tick.
                emit_progress(app, "downloading", Some(100), "下载完成");
                break;
            }
            Ok(None) => {
                // Still running — emit a progress tick.
                if total > 0 {
                    let downloaded = fs::metadata(dest).map(|m| m.len()).unwrap_or(0);
                    let pct = ((downloaded as u64 * 100) / total).min(99) as u32;
                    let mb = downloaded / 1_048_576;
                    let total_mb = total / 1_048_576;
                    emit_progress(
                        app,
                        "downloading",
                        Some(pct),
                        &format!("下载中… {mb}/{total_mb} MB"),
                    );
                } else {
                    emit_progress(app, "downloading", None, "下载中…（约 95 MB）");
                }
                std::thread::sleep(std::time::Duration::from_millis(300));
            }
            Err(e) => {
                let _ = fs::remove_file(dest);
                return Err(format!("等待 curl 失败: {e}"));
            }
        }
        // Hard cap: 10 minutes. Avoid hanging forever on a stalled connection.
        if start.elapsed() > std::time::Duration::from_secs(600) {
            let _ = curl.kill();
            let _ = fs::remove_file(dest);
            return Err("下载超时（10 分钟无进展）".into());
        }
    }
    Ok(())
}

/// Fetch `Content-Length` for `url` via a `curl -I` HEAD request. Returns 0 on
/// any failure (caller treats 0 as "unknown size").
fn total_size(url: &str) -> Option<u64> {
    let out = Command::new("curl")
        .args([
            "-fsIL", // follow redirects, HEAD request, headers only
            "--max-time", "15",
            url,
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let headers = String::from_utf8_lossy(&out.stdout);
    // Take the LAST content-length: header (after redirects, the final hop).
    let len = headers
        .lines()
        .map(|l| l.trim())
        .rev()
        .find(|l| l.to_ascii_lowercase().starts_with("content-length:"))
        .and_then(|l| l.split(':').nth(1))
        .and_then(|s| s.trim().parse::<u64>().ok())?;
    Some(len)
}

/// Privileged .pkg install via macOS `osascript`, prompting for the admin
/// password once. Mirrors the `sudo_symlink` pattern used for the CLI symlink.
#[cfg(target_os = "macos")]
fn sudo_install_pkg(pkg_path: &Path) -> Result<(), String> {
    let script = format!(
        "installer -pkg {} -target /",
        shlex_quote(&pkg_path.to_string_lossy())
    );
    let apple = format!(
        "do shell script \"{}\" with administrator privileges",
        script.replace('\\', "\\\\").replace('"', "\\\""),
    );
    let out = Command::new("osascript")
        .args(["-e", &apple])
        .output()
        .map_err(|e| format!("启动 osascript 失败: {e}"))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let msg = stderr.trim();
        // Distinguish "user cancelled the auth prompt" from a real installer error.
        if msg.contains("-128") || msg.contains("User canceled") {
            return Err("用户取消了授权".into());
        }
        return Err(format!("安装失败（授权或 installer 出错）: {msg}"));
    }
    Ok(())
}

/// Resolve the latest Node v22 LTS version, for the UI to display before the
/// user clicks install. Always succeeds (falls back to a pinned version).
#[tauri::command]
pub fn cli_resolve_node_version() -> NodeVersionInfo {
    resolve_latest_node_version()
}

/// One-click Node.js install: download the official .pkg and run it with admin
/// auth. Streams progress via the `node-install-progress` event.
///
/// macOS-only: on other platforms returns an error immediately.
#[tauri::command]
pub async fn cli_install_node(app: AppHandle) -> Result<NodeInstallResult, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = &app;
        return Err("一键安装 Node 暂仅支持 macOS".into());
    }

    #[cfg(target_os = "macos")]
    {
        // Stage 1: resolve the version to install.
        emit_progress(&app, "resolving", None, "查询最新 Node 版本…");
        let info = tokio::task::spawn_blocking(|| resolve_latest_node_version())
            .await
            .map_err(|e| format!("版本查询任务失败: {e}"))?;
        let url = pkg_url(&info.version);

        // Stage 2: download the .pkg.
        emit_progress(
            &app,
            "downloading",
            Some(0),
            &format!("开始下载 Node {}…", info.version),
        );
        let dest = pkg_download_path();
        let app_clone = app.clone();
        let url_clone = url.clone();
        let dest_clone = dest.clone();
        tokio::task::spawn_blocking(move || {
            download_with_progress(&app_clone, &url_clone, &dest_clone)
        })
        .await
        .map_err(|e| format!("下载任务失败: {e}"))??;

        // Sanity check: make sure the file is non-trivially sized (a real .pkg
        // is tens of MB). A tiny file means the download silently failed.
        let pkg_size = fs::metadata(&dest)
            .map(|m| m.len())
            .map_err(|e| format!("读取下载文件失败: {e}"))?;
        if pkg_size < 1_000_000 {
            let _ = fs::remove_file(&dest);
            return Err(format!("下载文件异常（仅 {} 字节），可能链接失效", pkg_size));
        }

        // Stage 3: privileged install via osascript (user types password once).
        emit_progress(&app, "installing", None, "等待系统授权（请在弹窗输入开机密码）…");
        let dest_clone = dest.clone();
        let install_result = tokio::task::spawn_blocking(move || {
            sudo_install_pkg(&dest_clone)
        })
        .await
        .map_err(|e| format!("安装任务失败: {e}"))?;

        // Clean up the temp .pkg regardless of install outcome.
        let _ = fs::remove_file(&dest);

        if let Err(e) = install_result {
            emit_progress(&app, "error", None, &e);
            return Err(e);
        }

        // Stage 4: verify by re-detecting the node version.
        let detected = detect_node_version();
        let ok = detected
            .as_deref()
            .and_then(parse_major)
            .map(|maj| maj >= MIN_NODE_MAJOR)
            .unwrap_or(false);
        if !ok {
            emit_progress(
                &app,
                "error",
                None,
                "安装命令已完成，但未检测到可用的 Node（可能需要重开终端刷新 PATH）",
            );
            return Err("安装后未检测到可用 Node".into());
        }

        emit_progress(
            &app,
            "done",
            None,
            &format!("Node {} 安装成功", detected.as_deref().unwrap_or("")),
        );
        Ok(NodeInstallResult {
            success: true,
            version: detected,
            message: "Node 安装成功，excal 现在可以安装了。".into(),
        })
    }
}
