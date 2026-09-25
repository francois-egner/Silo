import type { LocalDragPayload, S3DragPayload } from "./S3Pane";

export type InAppDrag =
  | { source: "local"; payload: LocalDragPayload; label: string }
  | { source: "s3"; payload: S3DragPayload; label: string };

let active: InAppDrag | null = null;

export function setInAppDrag(drag: InAppDrag | null) {
  active = drag;
}

export function getInAppDrag(): InAppDrag | null {
  return active;
}
