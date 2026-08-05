//! CLI install: exposes commands for the Settings panel to install/uninstall
//! the bundled `excal` CLI as a symlink on the user's PATH.
//!
//! The CLI ships inside the app bundle under `Contents/Resources/cli/` (macOS),
//! configured via `tauri.conf.json` `bundle.resources`. It is self-contained
//! (zero npm deps, only `node:*` builtins) but requires Node ≥ 22.5 on the host
//! because of `node:sqlite`. This module does NOT bundle Node — it detects it
//! and reports the status, leaving installation to the user.
//!
//! Install target selection (in priority order):
//!   1. `~/.local/bin` — user-level, no sudo, conventional. Created if missing.
//!   2. `/usr/local/bin` — system-wide; if not user-writable, escalate via
//!      `osascript ... with administrator privileges` (macOS auth prompt).
//!
//! All commands return serializable structs (serde) so the webview can render
//! status cleanly. Errors are returned as `Result<_, String>` per Tauri convention.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// Minimum Node major version required by the CLI (`node:sqlite` needs ≥ 22.5).
const MIN_NODE_MAJOR: u32 = 22;

/// The CLI entry script, relative to the bundle's resource dir.
const CLI_ENTRY_REL: &str = "cli/bin/excal.mjs";

/// The symlink name placed on PATH.
const LINK_NAME: &str = "excal";

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
