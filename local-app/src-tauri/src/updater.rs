use std::time::{Duration, Instant};

use reqwest::Url;
use semver::Version;
use serde::{Deserialize, Serialize};
use tauri::{ipc::Channel, State};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::Mutex;

const REPOSITORY: &str = "https://github.com/Stubsx/excalidraw-local";
const RELEASES_API: &str =
    "https://api.github.com/repos/Stubsx/excalidraw-local/releases?per_page=100";

#[derive(Default)]
pub struct UpdateState(Mutex<PendingUpdate>);

#[derive(Default)]
struct PendingUpdate {
    update: Option<Update>,
    bytes: Option<Vec<u8>>,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    body: Option<String>,
    published_at: Option<String>,
    assets: Vec<Asset>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseStatus {
    current_version: String,
    version: Option<String>,
    notes: Option<String>,
    published_at: Option<String>,
    preview: bool,
    installable: bool,
    message: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    downloaded: u64,
    total: Option<u64>,
    verifying: bool,
}

fn release_version(release: &Release) -> Option<Version> {
    // Existing DMG previews use v0.x.y-preview while the app version is 0.x.y.
    Version::parse(
        release
            .tag_name
            .trim_start_matches('v')
            .trim_end_matches("-preview"),
    )
    .ok()
}

fn newest_release(releases: &[Release], preview: bool) -> Option<&Release> {
    releases
        .iter()
        .filter(|r| !r.draft && (preview || !r.prerelease))
        .filter(|r| preview || !r.tag_name.ends_with("-preview"))
        .filter_map(|r| release_version(r).map(|version| (r, version)))
        .max_by(|(_, a), (_, b)| a.cmp(b))
        .map(|(release, _)| release)
}

fn trusted_asset_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "更新下载地址无效")?;
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || !url
            .path()
            .starts_with("/Stubsx/excalidraw-local/releases/download/")
    {
        return Err("更新包必须来自本项目的 GitHub Release".into());
    }
    Ok(url)
}

#[tauri::command]
pub async fn updater_check(
    app: tauri::AppHandle,
    state: State<'_, UpdateState>,
    include_preview: bool,
) -> Result<ReleaseStatus, String> {
    let mut pending = state.0.try_lock().map_err(|_| "更新操作正在进行中")?;
    *pending = PendingUpdate::default();
    let current = app.package_info().version.clone();
    let mut status = ReleaseStatus {
        current_version: current.to_string(),
        version: None,
        notes: None,
        published_at: None,
        preview: false,
        installable: false,
        message: None,
    };
    let client = reqwest::Client::builder()
        .user_agent(concat!("Excalidraw-Local/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(|e| format!("无法初始化更新检查：{e}"))?;
    let response = client
        .get(RELEASES_API)
        .send()
        .await
        .map_err(|_| "无法连接 GitHub，请检查网络后重试")?;
    if matches!(response.status().as_u16(), 403 | 429) {
        return Err("GitHub 暂时限制了检查频率，请稍后重试".into());
    }
    let releases: Vec<Release> = response
        .error_for_status()
        .map_err(|e| format!("GitHub 更新服务暂时不可用：{e}"))?
        .json()
        .await
        .map_err(|_| "无法读取 GitHub 版本信息")?;
    let Some(release) = newest_release(&releases, include_preview) else {
        status.message = Some(if include_preview {
            "暂无可用的发布版本".into()
        } else {
            "暂无可用的正式版本；可以开启接收预览版".into()
        });
        return Ok(status);
    };
    let version = release_version(release).ok_or("版本号无效")?;
    if version <= current {
        return Ok(status);
    }
    status.version = Some(version.to_string());
    status.notes = release.body.clone();
    status.published_at = release.published_at.clone();
    status.preview = release.prerelease;
    let Some(manifest) = release.assets.iter().find(|a| a.name == "latest.json") else {
        status.message = Some("此版本仅提供安装包，请前往发布页下载".into());
        return Ok(status);
    };
    let endpoint = trusted_asset_url(&manifest.browser_download_url)?;
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| e.to_string())?
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(|e| e.to_string())?;
    let update = updater.check().await;
    let mut update = match update {
        Ok(Some(update)) => update,
        Ok(None) => return Err("发布页与更新清单的版本不一致，请稍后重试".into()),
        Err(tauri_plugin_updater::Error::TargetNotFound(_)) => {
            status.message = Some("此版本暂未提供适用于这台电脑的自动更新包".into());
            return Ok(status);
        }
        Err(e) => return Err(format!("无法读取更新清单，请重试：{e}")),
    };
    if update.version != version.to_string() {
        return Err("发布页与更新清单的版本不一致".into());
    }
    trusted_asset_url(update.download_url.as_str())?;
    // Downloading the full app can take longer than reading its small manifest.
    update.timeout = Some(Duration::from_secs(600));
    status.installable = cfg!(target_os = "macos");
    pending.update = Some(update);
    Ok(status)
}

#[tauri::command]
pub async fn updater_download(
    state: State<'_, UpdateState>,
    on_progress: Channel<DownloadProgress>,
) -> Result<(), String> {
    let mut pending = state.0.try_lock().map_err(|_| "更新操作正在进行中")?;
    if pending.bytes.is_some() {
        return Ok(());
    }
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    if executable.starts_with("/Volumes") {
        return Err("请先将 App 拖入“应用程序”文件夹，再进行自动更新".into());
    }
    let update = pending.update.as_ref().ok_or("请先检查更新")?;
    let mut downloaded = 0;
    let mut last_progress = Instant::now() - Duration::from_secs(1);
    let progress = on_progress.clone();
    let bytes = update
        .download(
            |chunk, total| {
                downloaded += chunk as u64;
                if last_progress.elapsed() >= Duration::from_millis(100)
                    || total == Some(downloaded)
                {
                    let _ = progress.send(DownloadProgress {
                        downloaded,
                        total,
                        verifying: false,
                    });
                    last_progress = Instant::now();
                }
            },
            || {
                let _ = on_progress.send(DownloadProgress {
                    downloaded: 0,
                    total: None,
                    verifying: true,
                });
            },
        )
        .await
        .map_err(|e| format!("下载或签名校验失败，请重试：{e}"))?;
    // The official updater verifies the signature before any bytes are staged.
    pending.bytes = Some(bytes);
    Ok(())
}

#[tauri::command]
pub async fn updater_install(
    app: tauri::AppHandle,
    state: State<'_, UpdateState>,
) -> Result<(), String> {
    let mut pending = state.0.try_lock().map_err(|_| "更新操作正在进行中")?;
    let update = pending.update.as_ref().ok_or("请先检查更新")?;
    let bytes = pending.bytes.as_ref().ok_or("请先下载并校验更新")?;
    update
        .install(bytes)
        .map_err(|e| format!("安装失败，可重试或前往发布页下载：{e}"))?;
    pending.bytes = None;
    // The frontend awaits the same flush-and-persist path used by normal quit.
    app.restart();
}

#[tauri::command]
pub fn open_project_page(app: tauri::AppHandle, releases: bool) -> Result<(), String> {
    let url = if releases {
        format!("{REPOSITORY}/releases")
    } else {
        REPOSITORY.into()
    };
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn release(tag: &str, preview: bool, draft: bool) -> Release {
        Release {
            tag_name: tag.into(),
            prerelease: preview,
            draft,
            body: None,
            published_at: None,
            assets: vec![],
        }
    }
    #[test]
    fn compares_versions_instead_of_publication_order_and_skips_drafts() {
        let releases = vec![
            release("v0.2.9", false, false),
            release("v0.2.10", false, false),
            release("v9.0.0", false, true),
            release("updater", false, false),
        ];
        assert_eq!(
            newest_release(&releases, false).unwrap().tag_name,
            "v0.2.10"
        );
    }
    #[test]
    fn preview_is_opt_in_and_legacy_preview_versions_match_the_app() {
        let releases = vec![
            release("v0.2.7", false, false),
            release("v0.2.8-preview", true, false),
        ];
        assert_eq!(newest_release(&releases, false).unwrap().tag_name, "v0.2.7");
        assert_eq!(
            release_version(newest_release(&releases, true).unwrap()).unwrap(),
            Version::new(0, 2, 8)
        );
        assert_eq!(
            release_version(&release("v0.2.7-preview", true, false)).unwrap(),
            Version::new(0, 2, 7)
        );
    }
    #[test]
    fn rejects_foreign_or_insecure_downloads() {
        for url in [
            "http://github.com/Stubsx/excalidraw-local/releases/download/v1/a",
            "https://github.com.evil.test/Stubsx/excalidraw-local/releases/download/v1/a",
            "https://github.com/elsewhere/repo/releases/download/v1/a",
            "https://user@github.com/Stubsx/excalidraw-local/releases/download/v1/a",
        ] {
            assert!(trusted_asset_url(url).is_err());
        }
        assert!(trusted_asset_url("https://github.com/Stubsx/excalidraw-local/releases/download/v0.2.7-preview/latest.json").is_ok());
    }
}
