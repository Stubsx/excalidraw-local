import type { AppUpdater } from "../updater";

export function AppUpdates({
  updater,
  disabled,
}: {
  updater: AppUpdater;
  disabled: boolean;
}) {
  const { release, phase, progress, preferences } = updater;
  const locked = disabled || updater.busy || updater.checking;
  const percent = progress?.total
    ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
    : undefined;
  const action = {
    downloading: percent === undefined ? "正在下载…" : `正在下载 ${percent}%`,
    verifying: "正在校验更新包…",
    saving: "正在保存图稿…",
    installing: "正在安装并重启…",
  }[phase as "downloading" | "verifying" | "saving" | "installing"];
  return (
    <section className="excal-app-updates" aria-labelledby="app-updates-title">
      <div className="excal-section-title">
        <h3 id="app-updates-title">应用更新</h3>
        <span className="excal-update-version">v{updater.version || "…"}</span>
      </div>
      <p className="excal-settings-desc">
        从 GitHub 获取新版本，安装前会保存当前图稿。
      </p>
      <div className="excal-update-preferences">
        <label>
          <input
            type="checkbox"
            checked={preferences.automatic}
            disabled={locked}
            onChange={(e) =>
              updater.changePreference("automatic", e.target.checked)
            }
          />
          自动检查更新
        </label>
        <label>
          <input
            type="checkbox"
            checked={preferences.preview}
            disabled={locked}
            onChange={(e) =>
              updater.changePreference("preview", e.target.checked)
            }
          />
          接收预览版
        </label>
      </div>
      <div className="excal-update-result" role="status" aria-live="polite">
        {updater.checking ? (
          "正在检查 GitHub Release…"
        ) : updater.available ? (
          <strong>
            发现新版本 {release?.version}
            {release?.preview ? " · 预览版" : ""}
          </strong>
        ) : phase === "current" ? (
          release?.message || "已是最新版本"
        ) : (
          "随时检查最新版本"
        )}
        {release?.version && release.message && <p>{release.message}</p>}
        {updater.checkedAt && !updater.checking && (
          <small>
            上次检查{" "}
            {updater.checkedAt.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </small>
        )}
      </div>
      {release?.version && release.notes && (
        <details className="excal-update-notes">
          <summary>更新说明</summary>
          <div>{release.notes}</div>
        </details>
      )}
      {updater.busy && (
        <div className="excal-update-progress">
          <progress
            aria-label="更新下载进度"
            max={100}
            value={phase === "downloading" ? percent : 100}
          />
          <span role="status">{action}</span>
        </div>
      )}
      {updater.error && (
        <p className="excal-update-error" role="alert">
          {updater.error}
        </p>
      )}
      <div className="excal-update-actions">
        <button
          className="excal-btn"
          disabled={locked}
          onClick={() => void updater.check()}
        >
          {updater.checking ? "检查中…" : "检查更新"}
        </button>
        {release?.version && release.installable && (
          <button
            className="excal-btn excal-btn--primary"
            disabled={locked}
            onClick={() => void updater.install()}
          >
            {updater.busy ? action : updater.error ? "重试更新" : "更新并重启"}
          </button>
        )}
        <button
          className="excal-btn excal-btn--ghost"
          disabled={updater.busy}
          onClick={() => void updater.openProject(true)}
        >
          发布记录 ↗
        </button>
      </div>
      <button
        className="excal-update-source"
        onClick={() => void updater.openProject()}
      >
        GitHub 开源项目 · MIT License ↗
      </button>
    </section>
  );
}
