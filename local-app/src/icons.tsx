/**
 * Local chrome icons.
 *
 * Excalidraw's icon module (`@excalidraw/excalidraw/components/icons`) exports
 * each icon as a *pre-rendered ReactElement* (the result of its `createIcon`
 * helper), NOT as a component. So `<PlusIcon />` won't typecheck — you render
 * them with `{PlusIcon}`.
 *
 * To keep call sites consistent (`<PlusIcon />` everywhere), this module wraps
 * the needed elements in trivial function components. For icons Excalidraw
 * doesn't ship (star / folder — it's a drawing tool, not a file manager) we
 * build them with the same `createIcon` + Tabler stroke style so they render
 * identically to the bundled ones.
 */
import {
  createIcon,
  PlusIcon as PlusIconEl,
  CloseIcon as CloseIconEl,
  TrashIcon as TrashIconEl,
  ImageIcon as ImageIconEl,
  searchIcon as searchIconEl,
  file as fileEl,
  LibraryIcon as LibraryIconEl,
  settingsIcon as settingsIconEl,
  copyIcon as copyIconEl,
  checkIcon as checkIconEl,
} from "@excalidraw/excalidraw/components/icons";

import type { ReactElement } from "react";

/** Wrap a pre-rendered icon element as a component. */
function asComponent(el: ReactElement) {
  return function IconComponent() {
    return el;
  };
}

export const PlusIcon = asComponent(PlusIconEl);
export const CloseIcon = asComponent(CloseIconEl);
export const TrashIcon = asComponent(TrashIconEl);
export const ImageIcon = asComponent(ImageIconEl);
export const searchIcon = asComponent(searchIconEl);
export const file = asComponent(fileEl);
export const LibraryIcon = asComponent(LibraryIconEl);
export const SettingsIcon = asComponent(settingsIconEl);
export const CopyIcon = asComponent(copyIconEl);
export const CheckIcon = asComponent(checkIconEl);

/**
 * Tabler "star" (outline). Excalidraw has no star icon, but this path is from
 * the same Tabler set Excalidraw sources its icons from, so it matches.
 * https://tabler.io/icons/icon/star
 */
const StarIconEl = createIcon(
  <svg fill="none" stroke="currentColor" strokeWidth={2}>
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M12 17.75l-6.172 3.245l1.179 -6.873l-5 -4.867l6.9 -1l3.086 -6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873z" />
  </svg>,
  { width: 24, height: 24 },
);

/**
 * Tabler "star-filled" — used for the starred (active) state.
 */
const StarFilledIconEl = createIcon(
  <svg fill="currentColor" stroke="none">
    <path d="M12.002 19.834l-4.323 2.383a1 1 0 0 1 -1.451 -1.054l.826 -4.823l-3.55 -3.318a1 1 0 0 1 .555 -1.715l4.9 -.713l2.19 -4.44a1 1 0 0 1 1.794 0l2.196 4.44l4.9 .713a1 1 0 0 1 .555 1.715l-3.55 3.318l.826 4.823a1 1 0 0 1 -1.45 1.054l-4.324 -2.383z" />
  </svg>,
  { width: 24, height: 24 },
);

/**
 * Tabler "folder" (outline). Excalidraw has no folder icon.
 * https://tabler.io/icons/icon/folder
 */
const FolderIconEl = createIcon(
  <svg fill="none" stroke="currentColor" strokeWidth={2}>
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2" />
  </svg>,
  { width: 24, height: 24 },
);

/**
 * Tabler "pencil" (outline). Used for the rename action.
 * https://tabler.io/icons/icon/pencil
 */
const PencilIconEl = createIcon(
  <svg fill="none" stroke="currentColor" strokeWidth={2}>
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M4 20h4l10.5 -10.5a1.5 1.5 0 0 0 0 -2.121l-3.879 -3.879a1.5 1.5 0 0 0 -2.121 0l-10.5 10.5v4z" />
    <path d="M13.5 6.5l4 4" />
  </svg>,
  { width: 24, height: 24 },
);

export const StarIcon = asComponent(StarIconEl);
export const StarFilledIcon = asComponent(StarFilledIconEl);
export const FolderIcon = asComponent(FolderIconEl);
export const PencilIcon = asComponent(PencilIconEl);

export function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="19" cy="12" r="1.7" />
    </svg>
  );
}

export function SparkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6Z" />
      <path d="m20 2 .6 1.4L22 4l-1.4.6L20 6l-.6-1.4L18 4l1.4-.6Z" />
    </svg>
  );
}

export function ArrowIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14m-5-5 5 5-5 5" />
    </svg>
  );
}

export function WorkspaceIcon() {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect
        x="4"
        y="4"
        width="12"
        height="12"
        rx="3"
        transform="rotate(-5 10 10)"
      />
      <path d="M10 20v5h7m-3-3 3 3-3 3" />
      <rect x="21" y="20" width="8" height="8" rx="2" />
      <path d="m24 4 5 7-5 7-5-7Z" />
    </svg>
  );
}
