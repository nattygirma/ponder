import { type ComponentProps, lazy, Suspense } from "react";
import type { ShareNoteImageDialog as ShareNoteImageDialogContent } from "./ShareNoteImageDialogContent";

export type { ShareNoteImageSource } from "./ShareNoteImageDialogContent";

// The image dialog brings the font coverage tables and the image renderer (about 400 KB). The editor
// mounts it only once "Share as image" is used, so it loads then instead of with every page.
const LoadedDialog = lazy(() =>
  import("./ShareNoteImageDialogContent").then((module) => ({ default: module.ShareNoteImageDialog })),
);

export const ShareNoteImageDialog = (props: ComponentProps<typeof ShareNoteImageDialogContent>) => (
  <Suspense fallback={null}>
    <LoadedDialog {...props} />
  </Suspense>
);
