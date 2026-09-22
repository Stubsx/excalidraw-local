import { useEffect, useState } from "react";

import { copyTextToSystemClipboard } from "@excalidraw/excalidraw/clipboard";

import { CheckIcon, CopyIcon } from "../icons";

import type { ReactNode } from "react";

const STARTER_PROMPT =
  "请使用 excalidraw-local 技能，新建一张中文产品上线流程图，包含需求确认、设计开发、测试验收、上线发布和复盘优化，布局清晰，保存到 Excalidraw Local 资料库，方便我继续编辑。";

export function SkillQuickStart({ children }: { children?: ReactNode }) {
  const [copyState, setCopyState] = useState<
    "idle" | "copying" | "copied" | "error"
  >("idle");

  useEffect(() => {
    if (copyState !== "copied") {
      return;
    }
    const timeout = window.setTimeout(() => setCopyState("idle"), 2500);
    return () => window.clearTimeout(timeout);
  }, [copyState]);

  const copyPrompt = async () => {
    setCopyState("copying");
    try {
      await copyTextToSystemClipboard(STARTER_PROMPT);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  };

  return (
    <div className="excal-install-result">
      <div className="excal-skill-ready-heading">
        <strong>✓ 技能已安装</strong>
        <button
          className="excal-btn excal-copy-prompt"
          disabled={copyState === "copying"}
          onClick={copyPrompt}
        >
          <span aria-hidden="true">
            {copyState === "copied" ? <CheckIcon /> : <CopyIcon />}
          </span>
          <span aria-live="polite">
            {copyState === "copied"
              ? "已复制"
              : copyState === "copying"
              ? "复制中…"
              : "复制提示词"}
          </span>
        </button>
      </div>
      <p className="excal-skill-next-step">
        在已安装技能的 AI 客户端中新开对话，粘贴即可开始。
      </p>
      <p className="excal-starter-prompt">{STARTER_PROMPT}</p>
      {copyState === "error" && (
        <p className="excal-settings-error" role="alert">
          复制失败，请重试，或选中上方提示词手动复制。
        </p>
      )}
      {children}
    </div>
  );
}
