//! Offline installation from the signed application resources. No shell downloads or sudo.
use serde::Serialize;
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

const MARKER: &str = ".excalidraw-local-install.json";
const LAUNCHER_MARKER: &str = "# Excalidraw Local managed launcher";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillTarget {
    id: String,
    name: String,
    path: String,
    detected: bool,
    installed: bool,
    existing: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupStatus {
    version: String,
    runtime_ready: bool,
    cli_installed: bool,
    cli_path: String,
    targets: Vec<SkillTarget>,
    default_shell: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupResult {
    installed: Vec<String>,
    backups: Vec<String>,
    cli_path: String,
    message: String,
}

fn target_specs() -> [(&'static str, &'static str, &'static str, &'static str); 5] {
    [
        (
            "agents",
            "通用目录 · Codex / ZCode",
            ".agents/skills",
            ".agents",
        ),
        ("codex", "Codex 兼容目录", ".codex/skills", ".codex"),
        ("claude", "Claude Code", ".claude/skills", ".claude"),
        ("kimi", "Kimi Code", ".kimi/skills", ".kimi"),
        ("zcode", "ZCode 独立目录", ".zcode/skills", ".zcode"),
    ]
}
fn home() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or("无法获取用户目录".into())
}
fn resources(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().resource_dir().map_err(|e| e.to_string())
}
fn ready(res: &Path) -> bool {
    res.join("runtime/node").is_file()
        && res.join("cli/bin/excal.mjs").is_file()
        && res.join("skill/excalidraw-local/SKILL.md").is_file()
}
fn owned_launcher(path: &Path) -> bool {
    if path.is_symlink() {
        return fs::read_link(path).is_ok_and(|v| v.ends_with("cli/bin/excal.mjs"));
    }
    fs::read_to_string(path).is_ok_and(|s| s.contains(LAUNCHER_MARKER))
}
fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[tauri::command]
pub fn setup_status(app: AppHandle) -> Result<SetupStatus, String> {
    let home = home()?;
    let res = resources(&app)?;
    let cli = home.join(".local/bin/excal");
    let targets = target_specs()
        .iter()
        .map(|(id, name, path, probe)| {
            let target = home.join(path).join("excalidraw-local");
            SkillTarget {
                id: id.to_string(),
                name: name.to_string(),
                path: target.display().to_string(),
                detected: home.join(probe).is_dir(),
                installed: target.join(MARKER).is_file(),
                existing: target.exists() || target.is_symlink(),
            }
        })
        .collect();
    Ok(SetupStatus {
        version: app.package_info().version.to_string(),
        runtime_ready: ready(&res),
        cli_installed: owned_launcher(&cli),
        cli_path: cli.display().to_string(),
        targets,
        default_shell: match std::env::var("SHELL")
            .unwrap_or_default()
            .rsplit('/')
            .next()
        {
            Some("bash") => "bash",
            Some("fish") => "fish",
            _ => "zsh",
        }
        .into(),
    })
}
fn write_atomic(path: &Path, bytes: &[u8], executable: bool) -> Result<(), String> {
    let parent = path.parent().ok_or("缺少父目录")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temp.write_all(bytes).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = if executable {
            0o755
        } else {
            fs::metadata(path)
                .map(|m| m.permissions().mode())
                .unwrap_or(0o644)
        };
        temp.as_file()
            .set_permissions(fs::Permissions::from_mode(mode))
            .map_err(|e| e.to_string())?;
    }
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
fn copy_tree(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(from).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_symlink() {
            return Err("技能资源不能包含符号链接".into());
        }
        if kind.is_dir() {
            copy_tree(&entry.path(), &to.join(entry.file_name()))?;
        } else {
            fs::copy(entry.path(), to.join(entry.file_name())).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
fn launcher(res: &Path) -> String {
    format!("#!/bin/sh\n{LAUNCHER_MARKER}\nset -eu\nresources={}\nif [ ! -x \"$resources/runtime/node\" ]; then\n  for app in '/Applications/Excalidraw Local.app' \"$HOME/Applications/Excalidraw Local.app\"; do\n    if [ -x \"$app/Contents/Resources/runtime/node\" ]; then resources=\"$app/Contents/Resources\"; break; fi\n  done\nfi\nif [ ! -x \"$resources/runtime/node\" ]; then echo '请打开 Excalidraw Local → 设置 → 更新技能。' >&2; exit 1; fi\nexec \"$resources/runtime/node\" --disable-warning=ExperimentalWarning \"$resources/cli/bin/excal.mjs\" \"$@\"\n", quote(&res.to_string_lossy()))
}
fn install_skill(
    home: &Path,
    res: &Path,
    id: &str,
    version: &str,
    script: &str,
) -> Result<Option<String>, String> {
    let spec = target_specs()
        .into_iter()
        .find(|s| s.0 == id)
        .ok_or("未知客户端")?;
    let parent = home.join(spec.2);
    fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
    let target = parent.join("excalidraw-local");
    let stage = tempfile::Builder::new()
        .prefix(".excal-stage-")
        .tempdir_in(&parent)
        .map_err(|e| e.to_string())?;
    copy_tree(&res.join("skill/excalidraw-local"), stage.path())?;
    write_atomic(&stage.path().join("scripts/excal"), script.as_bytes(), true)?;
    fs::write(
        stage.path().join(MARKER),
        serde_json::json!({"app":"com.excalidraw-local.app","version":version}).to_string(),
    )
    .map_err(|e| e.to_string())?;
    let mut backup = None;
    if target.exists() || target.is_symlink() {
        let destination = parent.join(format!(".excalidraw-local-backup-{}", uuid::Uuid::new_v4()));
        fs::rename(&target, &destination).map_err(|e| e.to_string())?;
        backup = Some(destination);
    }
    if let Err(e) = fs::rename(stage.path(), &target) {
        if let Some(old) = &backup {
            let _ = fs::rename(old, &target);
        }
        return Err(e.to_string());
    }
    Ok(backup.map(|p| p.display().to_string()))
}
fn configure_shell(home: &Path, shell: &str) -> Result<(), String> {
    let (file, command) = match shell {
        "none" => return Ok(()),
        "zsh" => (
            ".zshrc",
            format!(
                "export PATH={}:\"$PATH\"",
                quote(&home.join(".local/bin").to_string_lossy())
            ),
        ),
        "bash" => (
            ".bash_profile",
            format!(
                "export PATH={}:\"$PATH\"",
                quote(&home.join(".local/bin").to_string_lossy())
            ),
        ),
        "fish" => (
            ".config/fish/config.fish",
            "fish_add_path -- $HOME/.local/bin".into(),
        ),
        _ => return Err("未知终端类型".into()),
    };
    let mut path = home.join(file);
    if path.is_symlink() {
        path = path.canonicalize().map_err(|e| e.to_string())?;
    }
    let old = if path.exists() {
        fs::read_to_string(&path).map_err(|e| e.to_string())?
    } else {
        String::new()
    };
    let start = "# >>> Excalidraw Local >>>";
    let end = "# <<< Excalidraw Local <<<";
    let block = format!("{start}\n{command}\n{end}");
    let next = if let Some(a) = old.find(start) {
        let b = old[a..]
            .find(end)
            .ok_or("终端配置中的 Excalidraw 区块不完整，请先检查")?
            + a
            + end.len();
        format!("{}{}{}", &old[..a], block, &old[b..])
    } else {
        format!("{old}\n{block}\n")
    };
    if next != old {
        if path.exists() {
            fs::copy(
                &path,
                path.with_extension(format!("excal-backup-{}", uuid::Uuid::new_v4())),
            )
            .map_err(|e| e.to_string())?;
        }
        write_atomic(&path, next.as_bytes(), false)?;
    }
    Ok(())
}
#[tauri::command]
pub async fn setup_install(
    app: AppHandle,
    targets: Vec<String>,
    shell: String,
) -> Result<SetupResult, String> {
    // Keep filesystem work off the UI thread; serialize installs across reopened panels.
    static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _guard = LOCK.try_lock().map_err(|_| "另一个安装任务正在进行")?;
    tokio::task::spawn_blocking(move || {
        let home = home()?;
        let res = resources(&app)?;
        if !ready(&res) {
            return Err("安装资源不完整，请重新下载完整 App".into());
        }
        if targets.is_empty() {
            return Err("请至少选择一个客户端".into());
        }
        if targets
            .iter()
            .any(|id| !target_specs().iter().any(|s| s.0 == id))
        {
            return Err("未知客户端".into());
        }
        if !["none", "zsh", "bash", "fish"].contains(&shell.as_str()) {
            return Err("未知终端".into());
        }
        let cli = home.join(".local/bin/excal");
        if (cli.exists() || cli.is_symlink()) && !owned_launcher(&cli) {
            return Err(format!(
                "{} 已被其他程序使用，请先更名后重试。",
                cli.display()
            ));
        }
        let script = launcher(&res);
        // Install CLI before skills so a partially completed install remains usable.
        write_atomic(&cli, script.as_bytes(), true)?;
        configure_shell(&home, &shell)?;
        let mut installed = Vec::new();
        let mut backups = Vec::new();
        for id in targets {
            if installed.contains(&id) {
                continue;
            }
            match install_skill(
                &home,
                &res,
                &id,
                &app.package_info().version.to_string(),
                &script,
            ) {
                Ok(backup) => {
                    if let Some(path) = backup {
                        backups.push(path);
                    }
                    installed.push(id);
                }
                Err(e) => {
                    return Err(format!(
                        "已完成：{}；安装 {id} 失败：{e}。可重新扫描后重试。",
                        installed.join(", ")
                    ))
                }
            }
        }
        Ok(SetupResult {
            installed,
            backups,
            cli_path: cli.display().to_string(),
            message: "安装完成。新开 AI 对话即可使用；终端命令在新开终端中生效。".into(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shell_configuration_is_idempotent_and_preserves_existing_content() {
        let home = tempfile::tempdir().unwrap();
        fs::write(
            home.path().join(".zshrc"),
            "# my settings\nexport EDITOR=vim\n",
        )
        .unwrap();
        configure_shell(home.path(), "zsh").unwrap();
        let once = fs::read_to_string(home.path().join(".zshrc")).unwrap();
        configure_shell(home.path(), "zsh").unwrap();
        assert_eq!(
            once,
            fs::read_to_string(home.path().join(".zshrc")).unwrap()
        );
        assert!(once.starts_with("# my settings\nexport EDITOR=vim\n"));
    }
    #[test]
    fn installing_backs_up_custom_skill_and_rejects_unknown_targets() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("home");
        let res = temp.path().join("res");
        fs::create_dir_all(res.join("skill/excalidraw-local")).unwrap();
        fs::write(res.join("skill/excalidraw-local/SKILL.md"), "new").unwrap();
        let target = home.join(".kimi/skills/excalidraw-local");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("SKILL.md"), "custom").unwrap();
        let backup = install_skill(&home, &res, "kimi", "1", "#!/bin/sh\n")
            .unwrap()
            .unwrap();
        assert_eq!(
            fs::read_to_string(Path::new(&backup).join("SKILL.md")).unwrap(),
            "custom"
        );
        assert!(target.join("scripts/excal").is_file());
        assert!(install_skill(&home, &res, "../outside", "1", "").is_err());
    }
}
