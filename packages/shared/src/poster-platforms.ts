// Adapted from Qiaomu Design (MIT), same platform catalog used by the editor.
/** Platform presets: sizes, feed overlays that cover parts of a cover, and file-size limits. */
export interface Zone { x: number; y: number; w: number; h: number; en: string }
export interface Platform {
  id: string; en: string; icon: string; group: 'social' | 'video' | 'general';
  width: number; height: number; enHint: string;
  /** Inner text-safe margin as a fraction of the shorter side. */
  margin: number;
  /** Areas the platform usually draws over the cover (timestamps, counters, buttons). */
  avoid: Zone[];
  /** Upload limit in bytes when the platform has a documented one. */
  maxBytes?: number;
}

export const PLATFORMS: Platform[] = [
  { id: 'xhs', en: 'Xiaohongshu · 3:4', icon: 'book-heart', group: 'social', width: 1080, height: 1440, margin: 0.06, avoid: [],
    enHint: 'Note cover, 3:4 portrait is the standard' },
  { id: 'xhs-square', en: 'Xiaohongshu · 1:1', icon: 'square', group: 'social', width: 1080, height: 1080, margin: 0.07, avoid: [],
    enHint: 'Square cover, more compact in the feed' },
  { id: 'youtube', en: 'YouTube thumbnail', icon: 'play', group: 'video', width: 1280, height: 720, margin: 0.04, maxBytes: 2 * 1024 * 1024,
    avoid: [{ x: 0.82, y: 0.86, w: 0.18, h: 0.14, en: 'Duration' }],
    enHint: '1280×720, under 2MB; the duration badge covers the bottom-right corner' },
  { id: 'bilibili', en: 'Bilibili cover · 16:10', icon: 'tv', group: 'video', width: 1146, height: 717, margin: 0.04,
    avoid: [{ x: 0, y: 0.84, w: 1, h: 0.16, en: 'Stats bar' }],
    enHint: '1146×717; the feed overlays play counts along the bottom' },
  { id: 'bilibili-43', en: 'Bilibili upload · 4:3', icon: 'tv', group: 'video', width: 1200, height: 900, margin: 0.05,
    avoid: [{ x: 0, y: 0, w: 1, h: 0.08, en: 'Cropped in feed' }, { x: 0, y: 0.78, w: 1, h: 0.22, en: 'Crop + stats bar' }],
    enHint: '1200×900 upload cover; the feed crops it to 16:10, keep type in the middle band' },
  { id: 'bilibili-hd', en: 'Bilibili · 16:9 HD', icon: 'tv', group: 'video', width: 1920, height: 1080, margin: 0.04,
    avoid: [{ x: 0, y: 0.86, w: 1, h: 0.14, en: 'Stats bar' }],
    enHint: '1920×1080 widescreen cover' },
  { id: 'vertical', en: 'Douyin / Shorts · 9:16', icon: 'smartphone', group: 'video', width: 1080, height: 1920, margin: 0.06,
    avoid: [{ x: 0, y: 0.78, w: 0.8, h: 0.22, en: 'Caption' }, { x: 0.84, y: 0.5, w: 0.16, h: 0.4, en: 'Buttons' }],
    enHint: 'Vertical video; captions and buttons cover the bottom and right' },
  { id: 'wechat', en: 'WeChat banner · 2.35:1', icon: 'message-circle', group: 'social', width: 1410, height: 600, margin: 0.05, avoid: [],
    enHint: 'Article banner; the feed crops a square from the centre' },
  { id: 'x', en: 'X header · 5:2', icon: 'at-sign', group: 'social', width: 1500, height: 600, margin: 0.05, avoid: [{ x: 0, y: 0.55, w: 0.3, h: 0.45, en: 'Avatar' }],
    enHint: 'Profile header; the avatar covers the lower-left' },
  { id: 'square', en: 'Square · 1:1', icon: 'square', group: 'general', width: 1080, height: 1080, margin: 0.06, avoid: [], enHint: 'General square' },
  { id: 'wide', en: 'Landscape · 16:9', icon: 'rectangle-horizontal', group: 'general', width: 1920, height: 1080, margin: 0.05, avoid: [], enHint: 'General landscape' },
  { id: 'portrait', en: 'Portrait · 3:4', icon: 'rectangle-vertical', group: 'general', width: 1200, height: 1600, margin: 0.06, avoid: [], enHint: 'General portrait' },
];

export const DEFAULT_PLATFORM = 'xhs';
export function platformById(id: string | undefined): Platform | undefined { return PLATFORMS.find(p => p.id === id); }
export function platformFor(width: number, height: number, id?: string): Platform | undefined {
  const exact = platformById(id);
  if (exact && exact.width === width && exact.height === height) return exact;
  return PLATFORMS.find(p => p.width === width && p.height === height);
}
export function platformName(p: Platform, _zh?: boolean): string { return p.en; }
export const GROUPS: { id: Platform['group']; en: string }[] = [
  { id: 'social', en: 'Social' },
  { id: 'video', en: 'Video' },
  { id: 'general', en: 'General' },
];
