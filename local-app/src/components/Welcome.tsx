import { ArrowIcon, FolderIcon, PlusIcon, SparkIcon } from "../icons";

interface Props {
  onNew: () => void;
  onOpenFile: () => void;
  onOpenSettings: () => void;
}

/** An empty workspace is an invitation, never an automatically created scene. */
export function Welcome({ onNew, onOpenFile, onOpenSettings }: Props) {
  return (
    <section className="excal-welcome" aria-labelledby="welcome-title">
      <div className="excal-welcome-content">
        <div className="excal-welcome-sketch" aria-hidden="true">
          <svg viewBox="0 0 300 120" fill="none">
            <path
              className="sketch-line"
              d="M78 59c19-2 25-1 44 0m-8-7 8 7-9 7M190 60c17-2 26-1 43 0m-9-7 9 7-9 7"
            />
            <rect
              className="sketch-paper"
              x="8"
              y="30"
              width="69"
              height="57"
              rx="10"
              transform="rotate(-4 42 58)"
            />
            <path className="sketch-line" d="m145 29 43 30-43 30-22-30Z" />
            <rect
              className="sketch-accent"
              x="237"
              y="31"
              width="56"
              height="56"
              rx="28"
            />
            <path
              className="sketch-line"
              d="m254 59 8 8 16-18M26 52l30-2M26 64l21-1M99 94c28 15 63 18 97 6m-9-3 9 3-5 7"
            />
            <path
              className="sketch-spark"
              d="m219 13 1 9m-6-4 10-1M11 9l4 7m-7-1 10-5"
            />
          </svg>
        </div>
        <span className="excal-eyebrow">你的本地绘图工作台</span>
        <h1 id="welcome-title">把想法，画清楚。</h1>
        <p className="excal-welcome-description">
          从一张空白画布开始，或从左侧继续上次的图稿。
          <br />
          流程、架构、灵感，都可以在这里慢慢成形。
        </p>
        <div className="excal-welcome-actions">
          <button className="excal-btn excal-btn--primary" onClick={onNew}>
            <PlusIcon />
            新建画布<kbd>⌘ N</kbd>
          </button>
          <button className="excal-btn" onClick={onOpenFile}>
            <FolderIcon />
            打开文件<kbd>⌘ O</kbd>
          </button>
        </div>
        <p className="excal-welcome-note">
          图稿自动保存在本机，随时关闭，随时继续。
        </p>
        <button className="excal-ai-entry" onClick={onOpenSettings}>
          <span className="excal-ai-entry-icon">
            <SparkIcon />
          </span>
          <span>
            <strong>让 AI 帮你画第一笔</strong>
            <small>安装绘图技能，用一句话生成和修改图稿</small>
          </span>
          <ArrowIcon />
        </button>
      </div>
      <footer className="excal-welcome-footer">
        <span>
          <span className="excal-local-dot" />
          本地存储 · 无需登录
        </span>
        <span>
          搜索图稿 <kbd>⌘ ⇧ F</kbd>
        </span>
      </footer>
    </section>
  );
}
