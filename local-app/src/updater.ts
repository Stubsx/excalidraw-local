import { useCallback, useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";

export interface ReleaseStatus {
  currentVersion: string;
  version: string | null;
  notes: string | null;
  publishedAt: string | null;
  preview: boolean;
  installable: boolean;
  message: string | null;
}
export interface DownloadProgress {
  downloaded: number;
  total: number | null;
  verifying: boolean;
}
type Phase =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "verifying"
  | "saving"
  | "installing";
const PREFERENCE_KEY = "excal-app-updates";
const INSTALL_PHASES: Phase[] = [
  "downloading",
  "verifying",
  "saving",
  "installing",
];

function readPreferences() {
  try {
    const value = JSON.parse(localStorage.getItem(PREFERENCE_KEY) ?? "null");
    return {
      automatic: value?.automatic !== false,
      preview: value?.preview !== false,
    };
  } catch {
    return { automatic: true, preview: true };
  }
}

export function useAppUpdater(
  beforeRestart: () => Promise<void>,
  enabled: boolean,
) {
  const [preferences, setPreferences] = useState(readPreferences);
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const [phase, setPhase] = useState<Phase>("idle");
  const [version, setVersion] = useState("");
  const [release, setRelease] = useState<ReleaseStatus | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const active = useRef(false);
  const beforeRestartRef = useRef(beforeRestart);
  beforeRestartRef.current = beforeRestart;

  useEffect(() => {
    void getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);

  const check = useCallback(async () => {
    if (active.current) {
      return;
    }
    active.current = true;
    setPhase("checking");
    setError(null);
    setRelease(null);
    setProgress(null);
    try {
      const result = await invoke<ReleaseStatus>("updater_check", {
        includePreview: preferencesRef.current.preview,
      });
      setVersion(result.currentVersion);
      setRelease(result);
      setPhase(result.version ? "available" : "current");
      setCheckedAt(new Date());
    } catch (e) {
      setError(String(e));
      setPhase("idle");
    } finally {
      active.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled || !preferences.automatic) {
      return;
    }
    // Allow the workspace and saved scenes to load before checking in background.
    const timer = window.setTimeout(() => void check(), 5000);
    const interval = window.setInterval(() => void check(), 6 * 60 * 60 * 1000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [enabled, preferences.automatic, check]);

  const changePreference = useCallback(
    (key: "automatic" | "preview", value: boolean) => {
      if (active.current) {
        return;
      }
      const next = { ...preferencesRef.current, [key]: value };
      preferencesRef.current = next;
      setPreferences(next);
      try {
        localStorage.setItem(PREFERENCE_KEY, JSON.stringify(next));
      } catch {
        /* This session still uses the chosen preference. */
      }
      if (key === "preview") {
        void check();
      }
    },
    [check],
  );

  const install = useCallback(async () => {
    if (active.current || !release?.installable || !release.version) {
      return;
    }
    active.current = true;
    setError(null);
    setProgress(null);
    setPhase("downloading");
    const onProgress = new Channel<DownloadProgress>();
    onProgress.onmessage = (event) => {
      if (event.verifying) {
        setPhase("verifying");
      } else {
        setProgress(event);
      }
    };
    let downloaded = false;
    try {
      await invoke("updater_download", { onProgress });
      downloaded = true;
      setPhase("saving");
      await beforeRestartRef.current();
      setPhase("installing");
      await invoke("updater_install");
    } catch (e) {
      setError(
        `${downloaded ? "更新未完成，图稿仍保留在当前工作台。" : ""}${e}`,
      );
      setPhase("available");
    } finally {
      active.current = false;
    }
  }, [release]);

  const openProject = useCallback(async (releases = false) => {
    try {
      await invoke("open_project_page", { releases });
    } catch (e) {
      setError(`打开 GitHub 失败：${e}`);
    }
  }, []);

  return {
    version,
    release,
    phase,
    progress,
    error,
    checkedAt,
    preferences,
    busy: INSTALL_PHASES.includes(phase),
    checking: phase === "checking",
    available: !!release?.version,
    check,
    install,
    changePreference,
    openProject,
  };
}

export type AppUpdater = ReturnType<typeof useAppUpdater>;
