import type { MermaidThemeName, MermaidThemePalette } from "../components/ThemeProvider";
import { scaleMermaidSvg } from "./mermaid-svg";
import { getOfficialMermaidThemeVariables } from "./mermaid-theme";

interface MermaidRenderFallbackOptions {
  source?: string;
  renderBeautiful: () => string | Promise<string>;
  renderOfficial: () => string | Promise<string>;
}

export const renderMermaidWithFallback = async ({
  renderBeautiful,
  renderOfficial,
}: MermaidRenderFallbackOptions) => {
  try {
    return await renderBeautiful();
  } catch {
    return renderOfficial();
  }
};

let officialModule: Promise<typeof import("mermaid")["default"]> | undefined;
let compactModule: Promise<typeof import("beautiful-mermaid")> | undefined;
let officialQueue: Promise<unknown> = Promise.resolve();
let renderSequence = 0;

export const renderThemedMermaidSvg = (
  source: string,
  { theme, palette, font, padding }: {
    theme: MermaidThemeName;
    palette: MermaidThemePalette;
    font: string;
    padding: number;
  },
) => renderMermaidWithFallback({
  source,
  renderBeautiful: async () => {
    // Repository dependency patches preserve CJK group IDs and ELK edge offsets
    // (upstream PRs #132 and #152). Keep supported subgraphs on this renderer.
    const { renderMermaidSVG, THEMES } = await (compactModule ??= import("beautiful-mermaid"));
    return scaleMermaidSvg(renderMermaidSVG(source, {
      ...THEMES[theme], ...palette, transparent: true, font, padding,
    }));
  },
  renderOfficial: () => {
    // Mermaid configuration is global. Keep initialization and rendering together
    // when several blocks or export jobs request different themes concurrently.
    const result = officialQueue.then(async () => {
      const mermaid = await (officialModule ??= import("mermaid").then(({ default: module }) => module));
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme: "base",
        themeVariables: getOfficialMermaidThemeVariables(palette),
      });
      // Without suppressErrors, a bad diagram throws Mermaid's own parse error, which the block shows.
      await mermaid.parse(source);
      const { svg } = await mermaid.render(`ponder-mermaid-${++renderSequence}`, source);
      return svg;
    });
    officialQueue = result.catch(() => undefined);
    return result;
  },
});
