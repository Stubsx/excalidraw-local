import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { CloseIcon } from "../icons";

interface Target {
  id: string;
  name: string;
  path: string;
  detected: boolean;
  installed: boolean;
  existing: boolean;
}
interface Status {
  version: string;
  runtimeReady: boolean;
  cliInstalled: boolean;
  cliPath: string;
  targets: Target[];
  defaultShell: string;
}
interface Result {
  installed: string[];
  backups: string[];
  cliPath: string;
  message: string;
}
interface Props {
  open: boolean;
  onClose: () => void;
}

export function SettingsPanel({ open, onClose }: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  const [selected, setSelected] = useState<string[]>(["agents"]);
  const [shell, setShell] = useState("none");
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const panel = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const ticket = ++generation.current;
    setScanning(true);
    setError(null);
    try {
      const value = await invoke<Status>("setup_status");
      if (generation.current === ticket) {
        setStatus(value);
      }
    } catch (e) {
      if (generation.current === ticket) {
        setError(String(e));
      }
    } finally {
      if (generation.current === ticket) {
        setScanning(false);
      }
    }
  }, []);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  useEffect(() => {
    if (open) {
      void refresh();
      setResult(null);
    }
    return () => {
      invalidate();
    };
  }, [open, refresh, invalidate]);
  useEffect(() => {
    if (!open) {
      return;
    }
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const keydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (!busy) {
          onClose();
        }
      }
      if (e.key === "Tab") {
        const controls = panel.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, a[href]",
        );
        if (!controls?.length) {
          return;
        }
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown, true);
    return () => {
      document.removeEventListener("keydown", keydown, true);
      previouslyFocused?.focus();
    };
  }, [open, onClose, busy]);
  const install = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await invoke<Result>("setup_install", {
        targets: selected,
        shell,
      });
      setResult(response);
      await refresh();
    } catch (e) {
      setError(String(e));
      await refresh();
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  if (!open) {
    return null;
  }
  return (
    <>
      <div
        className="excal-settings-backdrop"
        onClick={() => {
          if (!busy) {
            onClose();
          }
        }}
      />
      <aside
        ref={panel}
        className="excal-settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <header className="excal-settings-header">
          <h2 id="settings-title">设置</h2>
          <button
            ref={closeButton}
            className="excal-btn excal-btn--icon excal-btn--ghost"
            title="关闭设置"
            disabled={busy}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>
        <div className="excal-settings-body">
          <section className="excal-skill-intro">
            <span className="excal-settings-eyebrow">EXCALIDRAW × AI</span>
            <h3>
              让你的 AI 助手
              <br />
              直接画进本地资料库
            </h3>
            <p>
              把绘图技能安装到常用客户端。用一句话生成流程图、修改已有图稿、导出清晰图片，完成后还能在这里继续编辑。
            </p>
            <div className="excal-skill-example">
              “帮我画一张产品上线流程图，存到资料库。”
            </div>
            <div className="excal-skill-facts">
              <span>本机存储</span>
              <span>自动准备依赖</span>
              <span>无需管理员权限</span>
            </div>
          </section>
          <section className="excal-settings-section">
            <div className="excal-section-title">
              <h3>1. 选择 AI 客户端</h3>
              <button
                className="excal-btn excal-btn--ghost"
                disabled={busy || scanning}
                onClick={refresh}
              >
                {scanning ? "检测中…" : "重新扫描"}
              </button>
            </div>
            <p className="excal-settings-desc">
              推荐使用通用目录。Kimi
              或需要独立配置的客户端，可单独选择。已有同名技能会先备份。
            </p>
            <div className="excal-target-list">
              {status?.targets.map((target) => (
                <label
                  key={target.id}
                  className={`excal-target${
                    selected.includes(target.id)
                      ? " excal-target--selected"
                      : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(target.id)}
                    disabled={busy}
                    onChange={(e) =>
                      setSelected((prev) =>
                        e.target.checked
                          ? [...prev, target.id]
                          : prev.filter((id) => id !== target.id),
                      )
                    }
                  />
                  <span className="excal-target-copy">
                    <strong>{target.name}</strong>
                    <small>{target.path}</small>
                  </span>
                  <span className="excal-target-state">
                    {target.installed
                      ? "已安装"
                      : target.existing
                      ? "已有技能"
                      : target.detected
                      ? "已检测到"
                      : target.id === "agents"
                      ? "推荐"
                      : "未检测到"}
                  </span>
                </label>
              ))}
            </div>
            {!status && !scanning && (
              <p className="excal-settings-desc">
                尚未获取安装状态，请重新扫描。
              </p>
            )}
          </section>
          <section className="excal-settings-section">
            <h3>2. 终端命令</h3>
            <p className="excal-settings-desc">
              技能可直接调用 App 自带工具。若也想在终端输入
              excal，请选择你使用的终端环境。
            </p>
            <select
              className="excal-input excal-shell-select"
              aria-label="终端环境"
              value={shell}
              disabled={busy}
              onChange={(e) => setShell(e.target.value)}
            >
              <option value="none">仅安装技能，不修改终端配置</option>
              <option value="zsh">Zsh · macOS 默认终端</option>
              <option value="bash">Bash</option>
              <option value="fish">Fish</option>
            </select>
            <div className="excal-runtime-status">
              {status
                ? status.runtimeReady
                  ? "✓ 内置运行环境已就绪，无需额外下载"
                  : "运行环境缺失，请重新下载完整 App"
                : "正在检查内置运行环境…"}
            </div>
          </section>
          {error && (
            <div
              className="excal-settings-toast excal-settings-error"
              role="alert"
            >
              {error}
            </div>
          )}
          {result && (
            <div className="excal-install-result" role="status">
              <strong>✓ 技能已安装</strong>
              <p>{result.message}</p>
              {result.backups.length > 0 && (
                <details>
                  <summary>查看备份位置</summary>
                  {result.backups.map((path) => (
                    <code key={path}>{path}</code>
                  ))}
                </details>
              )}
            </div>
          )}
          <button
            className="excal-btn excal-btn--primary excal-install-button"
            disabled={
              busy || scanning || !status?.runtimeReady || selected.length === 0
            }
            onClick={install}
          >
            {busy
              ? "正在安装技能与命令工具…"
              : result
              ? "再次安装 / 更新"
              : `安装到 ${selected.length} 个位置`}
          </button>
          <p className="excal-settings-footnote">
            Excalidraw Local {status?.version ?? ""} · 安装仅写入你的用户目录
          </p>
        </div>
      </aside>
    </>
  );
}
