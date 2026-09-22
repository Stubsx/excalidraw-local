import { useEffect, useRef, useState } from "react";

import { ensureThumbnail } from "../thumbnails";
import { ImageIcon } from "../icons";

import type { SceneListItem } from "../db/sceneStore";

export function SceneThumbnail({ item }: { item: SceneListItem }) {
  const container = useRef<HTMLSpanElement>(null);
  const [generated, setGenerated] = useState<{
    revision: number;
    value: string;
  } | null>(null);
  const [failedRevision, setFailedRevision] = useState<number | null>(null);
  const thumbnail =
    item.thumbnail ??
    (generated?.revision === item.updatedAt ? generated.value : undefined);
  const failed = failedRevision === item.updatedAt;

  useEffect(() => {
    if (item.thumbnail !== undefined) {
      return;
    }
    let cancelled = false;
    const generate = () => {
      void ensureThumbnail(item.id, item.updatedAt).then(
        (value) => {
          if (!cancelled && value !== null) {
            setGenerated({ revision: item.updatedAt, value });
          }
        },
        () => {
          if (!cancelled) {
            setFailedRevision(item.updatedAt);
          }
        },
      );
    };
    let observer: IntersectionObserver | undefined;
    if (typeof IntersectionObserver === "undefined") {
      generate();
    } else {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observer?.disconnect();
            generate();
          }
        },
        { rootMargin: "120px" },
      );
      if (container.current) {
        observer.observe(container.current);
      }
    }
    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [item.id, item.updatedAt, item.thumbnail]);

  return (
    <span
      ref={container}
      className={`excal-thumb${
        thumbnail === undefined && !failed ? " excal-thumb--loading" : ""
      }${thumbnail === "" ? " excal-thumb--blank" : ""}`}
      title={
        thumbnail === ""
          ? "空白画布"
          : thumbnail
          ? `${item.name}的预览`
          : failed
          ? "暂时无法生成预览"
          : "正在生成预览…"
      }
      aria-hidden="true"
    >
      {thumbnail ? (
        <img src={thumbnail} alt="" />
      ) : failed ? (
        <ImageIcon />
      ) : null}
    </span>
  );
}
