import { FONT_CATALOG, findCatalogFont } from "@ponder/shared/font-catalog";
import { loadCatalogFont, loadOfflineFonts, withFontDeadline } from "@ponder/shared/font-loader";
import { cache } from "fabric";
import { POSTER_FONTS } from "@ponder/shared";
export { POSTER_FONTS };
export async function loadPosterFont(family: string, text = "", { deadline = true }: { deadline?: boolean } = {}) {
  // The deadline must include bundled fallback preparation: a damaged local
  // asset can fall through to slow remote mirrors before catalog loading starts.
  const prepare = async () => {
    await loadOfflineFonts(text || "Ponder");
    const registrationFamily = family.split(",")[0].trim().replace(/^["']|["']$/g, "");
    const id = findCatalogFont(registrationFamily);
    if (!id) return;
    await loadCatalogFont(id, text || `${FONT_CATALOG[id].zh} ${FONT_CATALOG[id].en}`, { family: registrationFamily });
    cache.clearFontCache(family);
    // Fabric keys glyph metrics by the complete runtime fallback stack.
    cache.clearFontCache(`${registrationFamily}, "Ponder Offline Sans", sans-serif`);
  };
  await (deadline ? withFontDeadline(prepare()) : prepare());
}
export const loadDesignFonts = (families: string[], text: string) =>
  Promise.all([...new Set(families)].map(family => loadPosterFont(family, text).catch(() => { /* Templates still render with the offline default. */ })));
