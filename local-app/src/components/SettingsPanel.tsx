import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

import { CloseIcon } from "../icons";
import { COLORS } from "../styles";

/** Mirrors src-tauri/src/cli_install.rs `CliStatus` (camelCase via serde). */
interface CliStatus {
  bundledPath: string | null;
  installed: boolean;
  installedPath: string | null;
  nodePresent: boolean;
  nodeVersion: string | null;
  nodeOk: boolean;
  recommendedDir: string | null;
  recommendedDirOnPath: boolean;
}

interface InstallResult {
  success: boolean;
  linkPath: string | null;
  target: string | null;
  needsPathHint: boolean;
  message: string;
}

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Settings panel — currently hosts the "excal CLI" installer.
 *
 * Renders as a right-side drawer over the editor area. The CLI ships inside the
 * app bundle; here the user can symlink it onto their PATH with one click,
 * check Node availability, and see copy-paste-ready PATH hints.
 */
export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const [status, setStatus] = useState<CliStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await invoke<CliStatus>("cli_status");
      setStatus(s);
    } catch (e) {
      setToast(`状态检测失败: ${e}`);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setToast(null);
      refresh();
    }
  }, [open, refresh]);

  const handleInstall = useCallback(async () => {
    setBusy(true);
    setToast(null);
    try {
      const r = await invoke<InstallResult>("cli_install", {});
      setToast(r.message);
      refresh();
    } catch (e) {
      setToast(`安装失败: ${e}`);
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const handleUninstall = useCallback(async () => {
    setBusy(true);
    setToast(null);
    try {
      const r = await invoke<InstallResult>("cli_uninstall", {});
      setToast(r.message);
      refresh();
    } catch (e) {
      setToast(`卸载失败: ${e}`);
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  // PATH hint command shown when install dir isn't on PATH.
  const pathHintCmd =
    status?.recommendedDir && !status.recommendedDirOnPath
      ? `echo 'export PATH="${status.recommendedDir}:$PATH"' >> ~/.zshrc`
      : null;

  const copyPathHint = useCallback(async () => {
    if (!pathHintCmd) return;
    try {
      await navigator.clipboard.writeText(pathHintCmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard may be unavailable; ignore
    }
  }, [pathHintCmd]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop — clicking it closes the panel. */}
      <div className="excal-settings-backdrop" onClick={onClose} />
      <aside className="excal-settings-panel">
        <header className="excal-settings-header">
          <h2>设置</h2>
          <button
            className="excal-btn excal-btn--icon excal-btn--ghost"
            title="关闭"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>

        <div className="excal-settings-body">
          {/* ---------------- excal CLI section ---------------- */}
          <section className="excal-settings-section">
            <h3>命令行工具 <code>excal</code></h3>
            <p className="excal-settings-desc">
              把随 app 分发的 <code>excal</code> 命令安装到终端，即可在命令行
              渲染图、管理资料库、配合脚本/Agent 自动化。
            </p>

            {/* status rows */}
            <ul className="excal-status-list">
              <StatusRow
                ok={status?.installed ?? false}
                label="excal 命令"
                value={
                  status?.installed
                    ? status.installedPath ?? "已安装"
                    : "未安装"
                }
              />
              <StatusRow
                ok={status?.nodeOk ?? false}
                label="Node.js（CLI 依赖）"
                value={
                  status?.nodePresent
                    ? `${status.nodeVersion}${status.nodeOk ? "" : "（需 ≥ 22.5）"}`
                    : "未检测到 Node"
                }
                hint={
                  status?.nodePresent
                    ? status.nodeOk
                      ? null
                      : "版本过低，请升级：nodejs.org"
                    : "请先安装 Node.js ≥ 22.5：nodejs.org"
                }
              />
            </ul>

            {/* actions */}
            <div className="excal-settings-actions">
              {status?.installed ? (
                <button
                  className="excal-btn"
                  onClick={handleUninstall}
                  disabled={busy}
                >
                  卸载
                </button>
              ) : (
                <button
                  className="excal-btn excal-btn--primary"
                  onClick={handleInstall}
                  disabled={busy || !status?.bundledPath}
                  title={
                    !status?.bundledPath
                      ? "未在 bundle 内找到 CLI 资源"
                      : undefined
                  }
                >
                  {busy ? "处理中…" : "安装到 PATH"}
                </button>
              )}
              <button
                className="excal-btn excal-btn--ghost"
                onClick={refresh}
                disabled={busy}
              >
                重新检测
              </button>
            </div>

            {/* PATH hint */}
            {pathHintCmd && (
              <div className="excal-pathhint">
                <p>
                  已安装到 <code>{status?.recommendedDir}</code>，但该目录不在
                  PATH 中。把下面这行加到 <code>~/.zshrc</code> 后重开终端：
                </p>
                <pre className="excal-codeblock">
                  <code>{pathHintCmd}</code>
                </pre>
                <button
                  className="excal-btn excal-btn--ghost"
                  onClick={copyPathHint}
                >
                  {copied ? "已复制 ✓" : "复制命令"}
                </button>
              </div>
            )}

            {/* toast */}
            {toast && <div className="excal-settings-toast">{toast}</div>}

            {/* usage */}
            <details className="excal-settings-usage">
              <summary>用法示例</summary>
              <pre className="excal-codeblock">
                <code>{`excal local ls                      # 列出资料库
excal local render 图.excalidraw -o 图.png   # 渲染成 PNG
excal local import 图.excalidraw --name 架构 # 导入资料库
excal local gen --json '{...}' -o m.excalidraw  # 从 spec 生成`}</code>
              </pre>
            </details>
          </section>
        </div>
      </aside>
    </>
  );
}

function StatusRow({
  ok,
  label,
  value,
  hint,
}: {
  ok: boolean;
  label: string;
  value: string;
  hint?: string | null;
}) {
  return (
    <li className="excal-status-row">
      <span
        className="excal-status-dot"
        style={{
          backgroundColor: ok ? "var(--color-primary)" : COLORS.danger,
        }}
      />
      <span className="excal-status-label">{label}</span>
      <span className="excal-status-value">{value}</span>
      {hint && <span className="excal-status-hint">{hint}</span>}
    </li>
  );
}
