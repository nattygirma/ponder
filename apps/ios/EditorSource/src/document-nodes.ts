import { ImageGallery, MergeDivider } from "@ponder/shared";
import { createNativeImageGalleryView } from "@ponder/shared/native-image-gallery";

export { ImageGallery, MergeDivider };

/** Same schema as shared `ImageGallery`; only the native node view differs. */
export const createIosImageGallery = (getLocale: () => string) =>
  ImageGallery.extend({
    addNodeView() {
      return createNativeImageGalleryView(getLocale);
    },
  });
