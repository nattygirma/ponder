import { noteImageAssetUrls } from "@ponder/shared/note-image-assets";
import { configureBundledFontAssets } from "@ponder/shared/font-assets-registry";

/** Register default asset locations without downloading fonts for system typography. */
export const installEditorBodyFontFaces = () => {
  if (typeof document === "undefined") return;
  configureBundledFontAssets(noteImageAssetUrls);
};
