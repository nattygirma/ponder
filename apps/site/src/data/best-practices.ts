import type { ImageMetadata } from "astro";
import type { SiteLocale } from "../i18n";

import classThreePaneImg from "../../../../docs/assets/best-practices/original-image/class-three-pane/image.png";
import wechatChatSelectImg from "../../../../docs/assets/best-practices/original-image/wechat-chat-message-import/select-export.png";
import wechatChatNoteImg from "../../../../docs/assets/best-practices/original-image/wechat-chat-message-import/import-as-note.png";
import wechatArticleEnterImg from "../../../../docs/assets/best-practices/original-image/app-share/wechat-article/share-enter.jpg";
import wechatArticleSharingImg from "../../../../docs/assets/best-practices/original-image/app-share/wechat-article/sharing.jpg";
import wechatArticleInNoteImg from "../../../../docs/assets/best-practices/original-image/app-share/wechat-article/in-note.jpg";
import socialImageEnterImg from "../../../../docs/assets/best-practices/original-image/app-share/socia-image/share-enter.jpg";
import socialImageSharingImg from "../../../../docs/assets/best-practices/original-image/app-share/socia-image/sharing.jpg";
import socialImageInNoteImg from "../../../../docs/assets/best-practices/original-image/app-share/socia-image/share-in-note.jpg";
import xhsClipImg from "../../../../docs/assets/best-practices/original-image/web-clipper/xiaohongshu/xiaohongshu.png";
import xhsInNoteImg from "../../../../docs/assets/best-practices/original-image/web-clipper/xiaohongshu/xiaohongshu-in-note.png";
import twitterClipImg from "../../../../docs/assets/best-practices/original-image/web-clipper/twitter/twitter.png";
import twitterInNoteImg from "../../../../docs/assets/best-practices/original-image/web-clipper/twitter/twitter-in-note.png";
import zhihuClipImg from "../../../../docs/assets/best-practices/original-image/web-clipper/zhihu/zhihu.png";
import zhihuInNoteImg from "../../../../docs/assets/best-practices/original-image/web-clipper/zhihu/zhihu-in-note.png";
import redditClipImg from "../../../../docs/assets/best-practices/original-image/web-clipper/reddit/reddit.png";
import redditInNoteImg from "../../../../docs/assets/best-practices/original-image/web-clipper/reddit/reddit-in-note.png";
import insClipImg from "../../../../docs/assets/best-practices/original-image/web-clipper/instgram/ins.png";
import insInNoteImg from "../../../../docs/assets/best-practices/original-image/web-clipper/instgram/ins-in-note.png";
import githubClipImg from "../../../../docs/assets/best-practices/original-image/web-clipper/github/github.png";
import githubInNoteImg from "../../../../docs/assets/best-practices/original-image/web-clipper/github/github-in-note.png";
import aiMindmapImg from "../../../../docs/assets/best-practices/original-image/ai-diagram/ai-mindmap.png";
import aiFlowchartImg from "../../../../docs/assets/best-practices/original-image/ai-diagram/ai-flowchart.png";
import aiArchitectureImg from "../../../../docs/assets/best-practices/original-image/ai-diagram/ai-architecture.png";
import aiInfographicRoadmapImg from "../../../../docs/assets/best-practices/original-image/ai-diagram/ai-infographic-ai-roadmap.png";
import aiInfographicBytedanceImg from "../../../../docs/assets/best-practices/original-image/ai-diagram/ai-infographic-bytedance.png";
import databaseHotSelectImg from "../../../../docs/assets/best-practices/original-image/database-note/database-hot-select.png";
import databaseEmployeeImg from "../../../../docs/assets/best-practices/original-image/database-note/database-employee-register.png";
import databaseFormCreateImg from "../../../../docs/assets/best-practices/original-image/database-note/database-form-create.png";
import databaseFormOnlineImg from "../../../../docs/assets/best-practices/original-image/database-note/database-form-online.png";
import acpSupportListImg from "../../../../docs/assets/best-practices/original-image/acp/acp-support-list.png";
import acpSupportDialogImg from "../../../../docs/assets/best-practices/original-image/acp/acp-support-list-dialog.png";
import noteExportClearImg from "../../../../docs/assets/best-practices/original-image/note-export-image/clear-theme.png";
import noteExportCodeImg from "../../../../docs/assets/best-practices/original-image/note-export-image/code-theme.png";
import posterStudioImg from "../../../../docs/assets/best-practices/original-image/poster/ai-generate-poster.png";
import wechatCopyMenuImg from "../../../../docs/assets/best-practices/original-image/wechat-article-copy-to/right-menu.png";
import wechatCopyEditorImg from "../../../../docs/assets/best-practices/original-image/wechat-article-copy-to/show-in-wechat-editor.png";
import pluginOfficialImg from "../../../../docs/assets/best-practices/original-image/plugin/official-in.png";
import pluginApiImg from "../../../../docs/assets/best-practices/original-image/plugin/plugin-api.png";

export type ShowcaseCaseId =
  | "three-pane"
  | "wechat-chat"
  | "wechat-article"
  | "mobile-image"
  | "xiaohongshu"
  | "twitter"
  | "zhihu"
  | "reddit"
  | "instagram"
  | "github"
  | "ai-diagrams"
  | "ai-infographics"
  | "ai-database"
  | "database-form"
  | "acp-agent"
  | "note-export-image"
  | "poster-studio"
  | "wechat-mp-copy"
  | "plugin-ecosystem";

export type ShowcaseMediaLayout = "stack" | "grid-2" | "grid-3";

export interface ShowcaseCaseAssetConfig {
  layout: ShowcaseMediaLayout;
  images: ImageMetadata[];
}

export const showcaseCaseAssets: Record<ShowcaseCaseId, ShowcaseCaseAssetConfig> = {
  "three-pane": {
    layout: "stack",
    images: [classThreePaneImg],
  },
  "wechat-chat": {
    layout: "stack",
    images: [wechatChatSelectImg, wechatChatNoteImg],
  },
  "wechat-article": {
    layout: "grid-3",
    images: [wechatArticleEnterImg, wechatArticleSharingImg, wechatArticleInNoteImg],
  },
  "mobile-image": {
    layout: "grid-3",
    images: [socialImageEnterImg, socialImageSharingImg, socialImageInNoteImg],
  },
  xiaohongshu: {
    layout: "stack",
    images: [xhsClipImg, xhsInNoteImg],
  },
  twitter: {
    layout: "stack",
    images: [twitterClipImg, twitterInNoteImg],
  },
  zhihu: {
    layout: "stack",
    images: [zhihuClipImg, zhihuInNoteImg],
  },
  reddit: {
    layout: "stack",
    images: [redditClipImg, redditInNoteImg],
  },
  instagram: {
    layout: "stack",
    images: [insClipImg, insInNoteImg],
  },
  github: {
    layout: "stack",
    images: [githubClipImg, githubInNoteImg],
  },
  "ai-diagrams": {
    layout: "stack",
    images: [aiMindmapImg, aiFlowchartImg, aiArchitectureImg],
  },
  "ai-infographics": {
    layout: "stack",
    images: [aiInfographicRoadmapImg, aiInfographicBytedanceImg],
  },
  "ai-database": {
    layout: "stack",
    images: [databaseHotSelectImg, databaseEmployeeImg],
  },
  "database-form": {
    layout: "stack",
    images: [databaseFormCreateImg, databaseFormOnlineImg],
  },
  "acp-agent": {
    layout: "stack",
    images: [acpSupportListImg, acpSupportDialogImg],
  },
  "note-export-image": {
    layout: "stack",
    images: [noteExportClearImg, noteExportCodeImg],
  },
  "poster-studio": {
    layout: "stack",
    images: [posterStudioImg],
  },
  "wechat-mp-copy": {
    layout: "stack",
    images: [wechatCopyMenuImg, wechatCopyEditorImg],
  },
  "plugin-ecosystem": {
    layout: "stack",
    images: [pluginOfficialImg, pluginApiImg],
  },
};

export interface ShowcaseMediaCopy {
  caption: string;
  alt: string;
}

export interface ShowcaseCaseLink {
  label: string;
  href: string;
}

export interface ShowcaseCaseCopy {
  id: ShowcaseCaseId;
  number: string;
  title: string;
  lead: string;
  bullets: string[];
  links?: ShowcaseCaseLink[];
  media: ShowcaseMediaCopy[];
}

export interface ShowcaseCategoryCopy {
  id: string;
  badge: string;
  title: string;
  description: string;
  cases: ShowcaseCaseCopy[];
}

export interface BestPracticesPageLocaleCopy {
  eyebrow: string;
  title: string;
  description: string;
  zoomHint: string;
  closePreview: string;
  demoCta: string;
  deployCta: string;
  githubDocCta: string;
  githubDocHref: string;
  categories: ShowcaseCategoryCopy[];
}

const enUsCategories: ShowcaseCategoryCopy[] = [
  {
    id: "workspace",
    badge: "01 · Core Workspace",
    title: "Core Workspace & Focused Writing",
    description: "A classic three-pane structure (Notebook Tree · Note Stream · Editor Canvas) with hybrid WYSIWYG and Markdown editing.",
    cases: [
      {
        id: "three-pane",
        number: "01",
        title: "Classic Three-Pane Workspace & Distraction-Free Editing",
        lead: "Ponder features a classic three-pane structure (Notebook Tree · Note Stream · Editor Canvas):",
        bullets: [
          "Focus Mode: Resizable and collapsible sidebars allow instant toggling into full-screen writing mode.",
          "Hybrid Editing: The main editor supports both WYSIWYG rich text and Markdown syntax.",
        ],
        media: [
          {
            caption: "Three-Pane Workspace Layout",
            alt: "Ponder classic three-pane workspace with rich editor",
          },
        ],
      },
    ],
  },
  {
    id: "capture",
    badge: "02 · Omnichannel Capture",
    title: "Omnichannel Capture & Ingestion",
    description: "From mobile system share sheets and chat history archiving to structured Web Clipper capture across X, Reddit, Xiaohongshu, and Zhihu.",
    cases: [
      {
        id: "wechat-chat",
        number: "02",
        title: "WeChat Chat History Archiving",
        lead: "Select messages in WeChat, tap \"Combine and Forward\", and choose Ponder under \"Forward to Other Apps\" to convert conversations into structured notes.",
        bullets: [
          "Format Parsing: Parses senders, timestamps, emojis, and links into clean layouts.",
          "Media Preservation: Images are embedded inline; documents and media files (.xlsx, .pdf, .mp4) are saved as attachments with full-text search support.",
        ],
        media: [
          {
            caption: "1. Forward to Ponder",
            alt: "WeChat share to Ponder",
          },
          {
            caption: "2. Structured Note Preview",
            alt: "WeChat chat history imported into Ponder note",
          },
        ],
      },
      {
        id: "wechat-article",
        number: "03",
        title: "WeChat Article Clipping on Mobile",
        lead: "When reading WeChat Official Account articles on mobile, select \"Open in Ponder\" from the top-right menu.",
        bullets: [
          "Automatically extracts the title, body structure, and embedded images into clean Markdown.",
        ],
        media: [
          {
            caption: "1. Select \"Open in Ponder\"",
            alt: "WeChat article share menu select open in Ponder",
          },
          {
            caption: "2. Extracting Content",
            alt: "Ponder clipping modal extracting article",
          },
          {
            caption: "3. Generated Markdown Note",
            alt: "WeChat article clipped into neat note",
          },
        ],
      },
      {
        id: "mobile-image",
        number: "04",
        title: "Mobile Image Sharing to Notes",
        lead: "Select Ponder in the mobile system share sheet from any app to upload images and create notes titled \"Shared Image\" in the background.",
        bullets: [
          "Capture visual inspiration from any mobile app without interrupting your reading flow.",
        ],
        media: [
          {
            caption: "1. Share Image",
            alt: "Mobile app tap image share",
          },
          {
            caption: "2. Choose Ponder",
            alt: "System share sheet choose Ponder",
          },
          {
            caption: "3. Generated Image Note",
            alt: "Auto-created note with uploaded image",
          },
        ],
      },
      {
        id: "xiaohongshu",
        number: "05",
        title: "Xiaohongshu (RED) Note Clipping",
        lead: "Right-click any note page and select \"Save Note to Ponder\" using the Ponder Web Clipper extension.",
        bullets: [
          "Captures title, topic tags, body text, publish timestamp, and source URL.",
          "Automatically formats multi-image sets into multi-column gallery layouts.",
        ],
        media: [
          {
            caption: "1. Right-Click Clipper Menu",
            alt: "Right-click save Xiaohongshu note to Ponder",
          },
          {
            caption: "2. Multi-Column Gallery Note",
            alt: "Xiaohongshu note clipped into multi-column gallery",
          },
        ],
      },
      {
        id: "twitter",
        number: "06",
        title: "X (Twitter) Post & Quote Clipping",
        lead: "Right-click any post and select \"Save Tweet to Ponder\" with the Ponder Web Clipper extension.",
        bullets: [
          "Extracts author info, tweet content, external links, quote tweets, and multi-image attachments.",
          "Formats content into a multi-column gallery layout.",
        ],
        media: [
          {
            caption: "1. Right-Click Save Tweet",
            alt: "Right-click save tweet to Ponder",
          },
          {
            caption: "2. Note with Quotes & Gallery",
            alt: "X tweet clipped into Ponder note with quote",
          },
        ],
      },
      {
        id: "zhihu",
        number: "07",
        title: "Zhihu Answer & Column Article Clipping",
        lead: "Right-click any specific answer or article and select \"Save Answer/Article to Ponder\".",
        bullets: [
          "Parses question title, author, body, timestamp, and permalink into a structured Q&A note.",
        ],
        media: [
          {
            caption: "1. Right-Click Save Answer/Article",
            alt: "Right-click save Zhihu answer to Ponder",
          },
          {
            caption: "2. Structured Q&A Note Preview",
            alt: "Zhihu answer clipped into Ponder note",
          },
        ],
      },
      {
        id: "reddit",
        number: "08",
        title: "Reddit Discussion Post Clipping",
        lead: "Right-click on the post title or body and select \"Save Selection to Ponder\".",
        bullets: [
          "Captures thread title, subreddit (e.g. r/AskReddit), author handle, timestamp, and permalink to preserve community metadata.",
        ],
        media: [
          {
            caption: "1. Right-Click Save Post",
            alt: "Right-click save Reddit post to Ponder",
          },
          {
            caption: "2. Note with Community Metadata",
            alt: "Reddit post clipped into Ponder note",
          },
        ],
      },
      {
        id: "instagram",
        number: "09",
        title: "Instagram Post & Carousel Clipping",
        lead: "Right-click any Instagram post or carousel and select \"Save Post to Ponder\" with Ponder Web Clipper.",
        bullets: [
          "Extracts author handle, caption text, timestamp, and source URL while preserving hashtags and mention metadata.",
          "Captures full multi-image carousel sets, formatted automatically into a clean multi-column gallery layout.",
        ],
        media: [
          {
            caption: "1. Right-Click Save Instagram Post",
            alt: "Right-click save Instagram post to Ponder",
          },
          {
            caption: "2. Note with Metadata & Multi-Image Gallery",
            alt: "Instagram post clipped into Ponder note",
          },
        ],
      },
      {
        id: "github",
        number: "10",
        title: "GitHub Repository Metadata Clipping",
        lead: "Right-click anywhere on the GitHub repository page and select \"Save Repository Info to Ponder\".",
        bullets: [
          "Extracts repository name (Owner/Repo), description, homepage, language, license, and topic tags into a technical card note.",
        ],
        media: [
          {
            caption: "1. Right-Click Save Repository Info",
            alt: "Right-click save GitHub repo info to Ponder",
          },
          {
            caption: "2. Structured Repository Card Note",
            alt: "Ponder clipped GitHub repository card note effect",
          },
        ],
      },
    ],
  },
  {
    id: "ai-data",
    badge: "03 · AI & Structured Data",
    title: "AI-Powered Structuring & Multi-Dimensional Data",
    description: "Generate editable mind maps, flowcharts, architecture diagrams, infographics, and database tables from natural language, or connect local agents via ACP.",
    cases: [
      {
        id: "ai-diagrams",
        number: "11",
        title: "AI Conversational Generation of Mind Maps, Flowcharts & Architecture Diagrams",
        lead: "Prompt the AI Co-pilot (or connected local Agent) with natural language to create editable diagrams directly in notes.",
        bullets: [
          "Supports drag-and-drop node editing, auto-layout, conditional branches, and system topologies.",
        ],
        media: [
          {
            caption: "1. Interactive Mind Map",
            alt: "AI chat generates editable mind map",
          },
          {
            caption: "2. Standard Flowchart",
            alt: "AI chat generates editable flowchart",
          },
          {
            caption: "3. System Architecture Diagram",
            alt: "AI chat generates editable architecture diagram",
          },
        ],
      },
      {
        id: "ai-infographics",
        number: "12",
        title: "AI Generation of Structured Infographics (Timelines, Matrices & Quadrants)",
        lead: "Use built-in infographic templates (timelines, comparison matrices, quadrants, and hierarchy charts) by prompting the AI Co-pilot with your topic.",
        bullets: [
          "Organizes key facts and milestones into structured visual infographic notes.",
          "Refine through conversational follow-ups or export directly to vector graphics.",
        ],
        media: [
          {
            caption: "1. Technology Roadmap Infographic",
            alt: "AI generated LLM technology roadmap infographic",
          },
          {
            caption: "2. Milestone Timeline Infographic",
            alt: "AI generated ByteDance milestone timeline",
          },
        ],
      },
      {
        id: "ai-database",
        number: "13",
        title: "AI Conversational Database Table Generation",
        lead: "Send a prompt to the AI Co-pilot (e.g., \"Create a database table for social media content planning\" or \"Generate an employee onboarding tracker\") to construct complete data tables.",
        bullets: [
          "Infers column types (tags, text, dates, links) with initial sample rows.",
          "Supports views, filtering, sorting, and CSV export.",
        ],
        media: [
          {
            caption: "1. Content Planning Table",
            alt: "AI generated media topic tracker table",
          },
          {
            caption: "2. Employee Directory Table",
            alt: "AI generated employee directory database table",
          },
        ],
      },
      {
        id: "database-form",
        number: "14",
        title: "Public Online Form Collection from Database Tables",
        lead: "Click \"Form Collection\" at the top of any database table to generate a public online data entry form.",
        bullets: [
          "External respondents can submit information via browser without logging in.",
          "Submissions sync directly to the database table in real time.",
        ],
        media: [
          {
            caption: "1. Open \"Form Collection\"",
            alt: "Click form collection button in database",
          },
          {
            caption: "2. Public Form Page",
            alt: "Public online form submission interface",
          },
        ],
      },
      {
        id: "acp-agent",
        number: "15",
        title: "Connecting Local Agents via ACP for Note Interaction",
        lead: "Ponder natively supports ACP (Agent Client Protocol), allowing desktop clients to connect with local AI agent environments (such as Codex, Claude Code, DeepSeek Harness, Antigravity, etc.).",
        bullets: [
          "Local Authorization: Grants local agents secure read/write access to user notes.",
          "In-Editor Chat: Converse directly with local agents from the note sidebar for code reasoning, document synthesis, and knowledge retrieval.",
        ],
        media: [
          {
            caption: "1. Connect Local Agents via ACP in Settings",
            alt: "ACP client support list in settings",
          },
          {
            caption: "2. Note Sidebar Interaction",
            alt: "Sidebar chat with local ACP Agent",
          },
        ],
      },
    ],
  },
  {
    id: "publishing",
    badge: "04 · Styling & Publishing",
    title: "Visual Styling & Omnichannel Publishing",
    description: "Render notes into multi-theme share cards, design social media covers with 40+ templates, and copy inline-styled HTML for newsletters and blogs.",
    cases: [
      {
        id: "note-export-image",
        number: "16",
        title: "Note Export to Long Image & Code Cards",
        lead: "Use the \"Share as Image\" feature to render notes into high-resolution long images or cards.",
        bullets: [
          "Multiple Card Themes: Choose from 8 curated card themes (Transparent, Quote, Book Excerpt, Memo, Dark, and more) with customizable typography and layout.",
          "Technical Code Cards: A dedicated \"Code\" theme features macOS-style window controls, line numbers, and monospace syntax highlighting.",
        ],
        media: [
          {
            caption: "1. Card Theme Previews (e.g. Transparent)",
            alt: "Ponder share as image transparent theme preview",
          },
          {
            caption: "2. Font & Layout Customization",
            alt: "Ponder share as image font and typography settings",
          },
        ],
      },
      {
        id: "poster-studio",
        number: "17",
        title: "Social Media Poster & Cover Design from Notes",
        lead: "Click \"Create Poster\" in any note's action menu (or via \"New → Poster\") to load key takeaways and titles into the Poster Design Studio.",
        bullets: [
          "Offers 40+ design templates supporting 3:4, 1:1, and landscape aspect ratios.",
          "Customize layout, colors, and design elements on the canvas, then export high-resolution PNGs.",
        ],
        media: [
          {
            caption: "Poster Design Studio & Templates",
            alt: "Ponder poster studio with rich design templates",
          },
        ],
      },
      {
        id: "wechat-mp-copy",
        number: "18",
        title: "Copying Notes to WeChat Official Account & Blogs",
        lead: "Select \"Copy to Official Account / Blog\" from the note menu to convert notes into rich text with inline CSS.",
        bullets: [
          "Paste directly into WeChat Official Account or blog editors while preserving tables, callouts, code blocks, lists, and typography styles.",
        ],
        media: [
          {
            caption: "1. Copy to Official Account / Blog",
            alt: "Ponder note menu copy to WeChat MP",
          },
          {
            caption: "2. Rich Text Editor Paste Result",
            alt: "Note pasted into WeChat MP editor layout",
          },
        ],
      },
    ],
  },
  {
    id: "ecosystem",
    badge: "05 · Open Ecosystem",
    title: "Open Ecosystem & Extensibility",
    description: "Built-in extension manager and open Plugin API with one-click GitHub or Manifest installation and cross-device workspace sync.",
    cases: [
      {
        id: "plugin-ecosystem",
        number: "19",
        title: "Open Plugin API & Custom Plugin Development",
        lead: "Ponder features an extension manager supporting one-click installation via GitHub repository URLs or Manifest links, with cross-device workspace synchronization between Web and Desktop.",
        bullets: [
          "Core API Capabilities: Bidirectional note read/write, custom DOM panels/embed blocks, unified settings, isolated storage, and direct invocation of workspace-configured AI models.",
          "Official Reference Plugins: Task Aggregation (Ponder Tasks) and AI RSS Feed Assistant (Ponder AI RSS).",
        ],
        links: [
          {
            label: "Ponder Tasks Repo",
            href: "https://github.com/tianma-if/edgeever-tasks",
          },
          {
            label: "Ponder AI RSS Repo",
            href: "https://github.com/tianma-if/edgeever-ai-rss",
          },
          {
            label: "Plugin Development Guide",
            href: "https://github.com/tianma-if/edgeever/blob/main/docs/plugin-development.md",
          },
        ],
        media: [
          {
            caption: "1. Extension & Plugin Management Center",
            alt: "Ponder plugin marketplace and official extension management",
          },
          {
            caption: "2. Plugin API Namespaces & Documentation",
            alt: "Ponder plugin development API reference and documentation",
          },
        ],
      },
    ],
  },
];

export const bestPracticesPageCopy: Record<SiteLocale, BestPracticesPageLocaleCopy> = {
  "en-US": {
    eyebrow: "BEST PRACTICES & SHOWCASE",
    title: "19 Real-World Ponder Workflows & Showcase",
    description:
      "A visual walkthrough of core Ponder workflows across desktop and mobile: three-pane writing, omnichannel clipping, AI diagrams & databases, local ACP agents, poster studio, and open plugins.",
    zoomHint: "Click any screenshot to inspect full-resolution details",
    closePreview: "Close preview",
    demoCta: "Open Live Demo",
    deployCta: "Deploy with AI",
    githubDocCta: "View Document on GitHub",
    githubDocHref: "https://github.com/tianma-if/edgeever/blob/main/docs/best-practices.md",
    categories: enUsCategories,
  },
  ja: {
    eyebrow: "BEST PRACTICES & SHOWCASE",
    title: "Ponder 19 の実機デモとベストプラクティス",
    description:
      "クラシックな三ペイン執筆、マルチチャネル Web クリッピング、AI による図解・インフォグラフィック・多次元テーブル生成、ローカル ACP Agent 連携、ポスター作成、プラグイン拡張までの実機ワークフロー集です。",
    zoomHint: "スクリーンショットをクリックすると拡大表示できます",
    closePreview: "プレビューを閉じる",
    demoCta: "ライブデモを開く",
    deployCta: "AI で導入",
    githubDocCta: "GitHub でドキュメントを見る",
    githubDocHref: "https://github.com/tianma-if/edgeever/blob/main/docs/best-practices.md",
    categories: enUsCategories,
  },
  pl: {
    eyebrow: "BEST PRACTICES & SHOWCASE",
    title: "19 praktycznych scenariuszy i prezentacja Ponder",
    description:
      "Wizualny przewodnik po najważniejszych przepływach pracy w Ponder na komputerze i telefonie: pisanie w trzech panelach, wycinanie treści z sieci, diagramy i bazy danych AI, lokalni agenci ACP, studio plakatów i wtyczki.",
    zoomHint: "Kliknij dowolny zrzut ekranu, aby powiększyć",
    closePreview: "Zamknij podgląd",
    demoCta: "Otwórz demo na żywo",
    deployCta: "Wdróż z AI",
    githubDocCta: "Zobacz dokument na GitHub",
    githubDocHref: "https://github.com/tianma-if/edgeever/blob/main/docs/best-practices.md",
    categories: enUsCategories,
  },
};
