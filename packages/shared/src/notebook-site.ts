import { z } from "zod";

const httpsUrl = z.url({ protocol: /^https$/ });
/** Google Analytics 4 measurement ids look like `G-ABC123XYZ`. */
export const GA_MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{4,16}$/;
/** Favicons are stored inline as small PNG data URLs (resized in the browser before upload). */
export const NOTEBOOK_SITE_FAVICON_MAX_LENGTH = 12_000;
export const NOTEBOOK_SITE_THEMES = ["system", "light", "dark"] as const;
export type NotebookSiteTheme = (typeof NOTEBOOK_SITE_THEMES)[number];
export const NotebookSiteSettingsSchema = z.object({
  homeMemoId: z.string().nullable().default(null),
  logoUrl: httpsUrl.nullable().default(null),
  headerLinks: z.array(z.object({ label: z.string().trim().min(1), url: httpsUrl }).strict()).default([]),
  footerText: z.string().default(""),
  allowIndexing: z.boolean().default(false),
  sortMode: z.enum(["existing", "title"]).default("existing"),
  theme: z.enum(NOTEBOOK_SITE_THEMES).default("system"),
  contactButton: z.object({
    label: z.string().trim().min(1).max(40),
    url: z.union([httpsUrl, z.string().trim().regex(/^mailto:[^\s<>"]+@[^\s<>"]+$/i)]),
  }).strict().nullable().default(null),
  faviconDataUrl: z.string().max(NOTEBOOK_SITE_FAVICON_MAX_LENGTH)
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/).nullable().default(null),
  gaMeasurementId: z.string().trim().toUpperCase().regex(GA_MEASUREMENT_ID_PATTERN).nullable().default(null),
  description: z.string().trim().max(300).default(""),
  ogImageUrl: httpsUrl.nullable().default(null),
}).strict();
export type NotebookSiteSettings = z.infer<typeof NotebookSiteSettingsSchema>;
export const NotebookSiteUpdateSchema = z.object({
  siteSlug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]*$/).nullable().optional(),
  settings: z.object({
    homeMemoId: NotebookSiteSettingsSchema.shape.homeMemoId.removeDefault().optional(),
    logoUrl: NotebookSiteSettingsSchema.shape.logoUrl.removeDefault().optional(),
    headerLinks: NotebookSiteSettingsSchema.shape.headerLinks.removeDefault().optional(),
    footerText: NotebookSiteSettingsSchema.shape.footerText.removeDefault().optional(),
    allowIndexing: NotebookSiteSettingsSchema.shape.allowIndexing.removeDefault().optional(),
    sortMode: NotebookSiteSettingsSchema.shape.sortMode.removeDefault().optional(),
    theme: NotebookSiteSettingsSchema.shape.theme.removeDefault().optional(),
    contactButton: NotebookSiteSettingsSchema.shape.contactButton.removeDefault().optional(),
    faviconDataUrl: NotebookSiteSettingsSchema.shape.faviconDataUrl.removeDefault().optional(),
    gaMeasurementId: NotebookSiteSettingsSchema.shape.gaMeasurementId.removeDefault().optional(),
    description: NotebookSiteSettingsSchema.shape.description.removeDefault().optional(),
    ogImageUrl: NotebookSiteSettingsSchema.shape.ogImageUrl.removeDefault().optional(),
  }).strict().optional(),
}).strict();
export type NotebookSiteUpdate = z.infer<typeof NotebookSiteUpdateSchema>;
export const NotebookSiteExclusionSchema = z.object({ excluded: z.boolean() }).strict();
export const readNotebookSiteSettings = (raw?: string | null): NotebookSiteSettings => {
  try {
    const result = NotebookSiteSettingsSchema.safeParse(JSON.parse(raw || "{}"));
    if (result.success) return result.data;
  } catch { /* Malformed legacy settings retain conservative defaults. */ }
  return NotebookSiteSettingsSchema.parse({});
};

const collator = new Intl.Collator("en-US", { numeric: true, sensitivity: "base" });
export const compareNotebookSiteTitles = (a: { id: string; title?: string | null; name?: string }, b: { id: string; title?: string | null; name?: string }) =>
  collator.compare(a.title ?? a.name ?? "", b.title ?? b.name ?? "") || a.id.localeCompare(b.id);

export type NotebookSiteMemoPreview = { id: string; title: string | null; excerpt: string };
export type NotebookSiteSearchResult = {
  memos: Array<NotebookSiteMemoPreview & { notebookId: string; highlights: string[] }>;
  nextCursor: string | null;
};
export type NotebookSiteExclusions = {
  memos: Array<{ id: string; title: string | null }>;
  nextCursor: string | null;
};

export type NotebookSiteMemo = {
  id: string;
  title: string | null;
  notebookId: string;
  notebookName: string;
  excluded: boolean;
};
export type NotebookSiteContents = { memos: NotebookSiteMemo[]; nextCursor: string | null };
export type MemoNotebookSite = { notebookId: string; notebookName: string; excluded: boolean };
