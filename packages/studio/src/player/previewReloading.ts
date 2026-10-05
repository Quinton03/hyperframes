import { thumbnailScheduler } from "./lib/thumbnailScheduler";

let reloading = false;
let reloadRequested = false;
let scriptWrites = 0;

export function setPreviewReloading(next: boolean): void {
  reloading = next;
  thumbnailScheduler.setPreviewReloading(next);
}

/** Studio asked for a reload that has not begun yet; `previewReloadBegun` closes that gap. */
export function requestPreviewReload(): void {
  reloadRequested = true;
}

export function previewReloadBegun(): void {
  reloadRequested = false;
}

/** A script write counts from its send until its preview update is applied, or it fails. */
export async function whileScriptWrites<T>(write: () => Promise<T>): Promise<T> {
  scriptWrites += 1;
  try {
    return await write();
  } finally {
    scriptWrites -= 1;
  }
}

/** The one owner of "the preview is about to change": a canvas press waits for it. */
export function isPreviewChanging(): boolean {
  return reloading || reloadRequested || scriptWrites > 0;
}
