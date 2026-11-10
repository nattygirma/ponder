import { jaSiteCopy, jaSiteTagline } from "./i18n-ja";
import { plSiteCopy, plSiteTagline } from "./i18n-pl";

export const siteLocales = ["en-US", "ja", "pl"] as const;
export type SiteLocale = (typeof siteLocales)[number];

export const defaultSiteLocale: SiteLocale = "en-US";
export const unmatchedSiteLocale: SiteLocale = "en-US";
export const siteLocaleStorageKey = "ponder.site.locale";
export const siteLocaleDataAttribute = "data-ponder-site-locale";

export const siteLocalePrefixes: Record<SiteLocale, string> = {
  "en-US": "",
  ja: "/ja",
  pl: "/pl",
};

export const siteLocaleLabels: Record<SiteLocale, string> = {
  "en-US": "English",
  ja: "日本語",
  pl: "Polski",
};

export const siteTaglines = {
  "en-US": "AI-native knowledge base & Evernote/Obsidian alternative with instant sync & native MCP. Free on Cloudflare or self-hosted via Docker.",
  ja: jaSiteTagline,
  pl: plSiteTagline,
} as const satisfies Record<SiteLocale, string>;

const localePrefixPattern = /^\/(ja|pl)(?=\/|$)/;

export const stripSiteLocalePrefix = (path: string) => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return normalizedPath.replace(localePrefixPattern, "") || "/";
};

export const matchSiteLocale = (locale: string | null | undefined): SiteLocale | null => {
  if (!locale) {
    return null;
  }

  const normalized = locale.trim().replaceAll("_", "-").toLowerCase();

  if (normalized === "en" || normalized.startsWith("en-")) {
    return "en-US";
  }

  if (normalized === "ja" || normalized.startsWith("ja-")) {
    return "ja";
  }

  if (normalized === "pl" || normalized.startsWith("pl-")) {
    return "pl";
  }

  return null;
};

export const getSiteLocale = (pathname: string): SiteLocale => {
  if (pathname === "/ja" || pathname.startsWith("/ja/")) {
    return "ja";
  }

  if (pathname === "/pl" || pathname.startsWith("/pl/")) {
    return "pl";
  }

  return "en-US";
};

export const getLocalizedPath = (locale: SiteLocale, path: string) => {
  const barePath = stripSiteLocalePrefix(path);
  const prefix = siteLocalePrefixes[locale];

  if (!prefix) {
    return barePath;
  }

  return barePath === "/" ? `${prefix}/` : `${prefix}${barePath}`;
};

export const isExplicitSiteLocalePath = (pathname: string) => localePrefixPattern.test(pathname);

export const siteCopy = {
  "en-US": {
    layout: {
      defaultDescription:
        "Ponder is an open-source, AI-native knowledge base and modern notes workspace. Enjoy a classic three-pane productivity workflow (Tree View · Note List · Editor) across macOS, Windows, Linux, iOS, Android, and Web Clipper, with native ACP local agent synergy, companion sidebar, and visual diagram notes, running within Cloudflare's free tier or on Docker.",
      defaultTitle: `Ponder - ${siteTaglines["en-US"]}`,
      imageAlt: "Ponder notes app screenshot",
      ogLocale: "en_US",
    },
    nav: {
      homeAria: "Ponder home",
      features: "Features",
      guides: "Guides",
      deploy: "Deploy",
      cloudflareDeploy: "Cloudflare",
      dockerDeploy: "Docker",
      selfHostedAlternative: "Evernote alternative",
      migration: "Migrate from Evernote",
      evernoteMigration: "Migrate from Evernote",
      memosMigration: "Migrate from Memos",
      notionMigration: "Migrate from Notion",
      flomoMigration: "Migrate from Flomo",
      bestPractices: "Showcase",
      advancedPlay: "AI Agent plays",
      blog: "Blog",
      backToBlog: "Back to blog",
      contact: "Contact",
      privacy: "Privacy",
      demo: "Demo",
      language: "Language",
      languageMenu: "Change language",
      tagAll: "All",
      tagMigration: "Migration",
      tagMcp: "AI & MCP",
      tagSelfHosted: "Deployment",
      openSource: "Open Source",
    },
    hero: {
      slogan: siteTaglines["en-US"],
      popHighlight: "Classic Three-Pane AI Workspace · Native AI Synergy · Multi-Platform Apps",
      demo: "Live demo",
      agentInstall: "Deploy with AI",
      getApps: "Get Apps:",
      clipper: "Clipper",
      windows: "Windows",
      linux: "Linux",
      imageAlt: "Ponder product preview",
      badgeText: "💡 All Platforms: macOS, Windows, Linux, iOS, Android, Web Clipper · Native MCP & ACP Synergy · Cloudflare Free Tier & Docker",
    },
    bento: {
      eyebrow: "WHY PONDER",
      heading: "Rebuilt for Self-Hosted Knowledge & AI Workflows",
      subheading: "Say goodbye to ads, device caps, and expensive subscriptions. Every detail is crafted for a fast, open, and private second brain.",
      showcaseCta: "Explore 19 real-world workflows & screenshots",
      card1: {
        badge: "Classic UI",
        title: "Classic Three-Pane Layout, Faster & Lighter",
        desc: "Preserves the classic three-pane productivity workflow (Tree View · Note List · Editor). Switch freely between rich text and Markdown source, with unlimited nesting depth, focus mode, and light/dark custom CSS presets.",
        subBadge: "Dual View / Focus Mode / Custom CSS",
        treeTitle: "Notebooks",
        folder1: "01_Work_Inbox",
        folder2: "02_Ideas_Drafts",
        folder3: "03_Archive_Notes",
        folder4: "↳ 2026_Reading",
        listTitle: "Notes (18)",
        note1Title: "Ponder Architecture",
        note1Sub: "Cloudflare Workers / Docker & SQLite...",
        note2Title: "Local ACP Agent Connection",
        note2Sub: "Codex / Antigravity local synergy...",
        editorTitle: "Ponder Architecture",
        editorBody: "Ponder combines the classic 3-pane layout with AI Agent synergy and flexible deployment options.",
        editorSaveTag: "Auto-saved to SQLite",
      },
      card2: {
        badge: "AI Native",
        title: "Companion Sidebar & Local ACP Synergy",
        desc: "The persistent companion sidebar supports multi-chat threads and instant text selection actions. Desktop connects directly to local coding agents via ACP (Codex, Antigravity, Claude Code, WorkBuddy), while Remote MCP allows external agents to read and organize notes.",
        subBadge: "ACP + Remote MCP",
        mockupStatus: "ACP Local Agent & Sidebar Ready",
        mockupCmd: "> Analyze selected text & expand mind map",
        mockupResult: "Core insights extracted. Structured mind map branches created in the note.",
      },
      card3: {
        badge: "Flexible Deploy",
        title: "Cloudflare Free Tier, or 1-Line Docker Deploy",
        desc: "Personal use typically fits within Cloudflare's free tier (about 150k notes & 50k images), or deploy with Docker on your VPS, NAS, or private server and scale storage as needed.",
        subBadge: "Cloudflare Native / Docker",
        price: "$0",
        unit: "/ mo",
        sub: "Within Cloudflare's Free Tier",
        metric: "150,000+",
        metricSub: "Free Note Capacity (Scalable with Docker)",
      },
      card4: {
        badge: "Creator Tools",
        title: "Visual Diagram Notes & One-Click Styled Copy",
        desc: "Create native mind maps, flowcharts, and architecture diagrams directly in notes with one-prompt AI generation and auto-layout. One-click Markdown conversion to styled HTML for Substack, Medium, or WeChat, plus native Mermaid & LaTeX.",
        subBadge: "Diagrams / Flowcharts / Styled Copy",
        srcTag: "Visual Diagrams / Styled Copy",
        actionBtn: "Generate & Copy",
        previewTitle: "# Mind Maps, Flowcharts & Styled Copy",
        previewBody: "Structured diagrams sync across devices with vector export; rich text pastes cleanly into Substack or newsletter editors.",
      },
      card5: {
        badge: "Data Sovereignty",
        title: "Apps Across Platforms & Lossless ZIP Backup",
        desc: "Available on macOS, Windows, Linux, native iOS (SwiftUI), Android, and full-featured Web Clipper. Lossless ZIP export and standard SQLite ensure total ownership.",
        subBadge: "Multi-Platform + ZIP",
        archiveTitle: "ponder-backup.zip",
        archiveSub: "Markdown + Attachments + Revision History",
      },
    },
    marquee: {
      title: "Apps Across Platforms, Flexible Deploy & AI Synergy",
      subtitle: "From macOS, native iOS & Android apps to Docker self-hosting, styled creator copying, and Remote MCP collaboration.",
      items: [
        {
          tag: "macOS Desktop",
          title: "Electron + Rust + SQLite",
          desc: "Local SQLite mirror with ACP local agent support, focus mode & instant offline capture",
          icon: "bx:bxl-apple",
          color: "from-emerald-500/10 to-teal-500/5",
        },
        {
          tag: "iOS Native App",
          title: "Native SwiftUI Architecture",
          desc: "Published on App Store with share-sheet clipping, undo/redo & offline SQLite sync",
          icon: "bx:bx-mobile",
          color: "from-teal-500/10 to-emerald-500/5",
        },
        {
          tag: "Android App",
          title: "Google Play & Signed APK",
          desc: "Available on Google Play with offline editing, undo/redo & share-sheet clipping",
          icon: "bx:bxl-android",
          color: "from-green-500/10 to-emerald-500/5",
        },
        {
          tag: "Web Clipper",
          title: "Chrome, Edge & Firefox",
          desc: "Published on all stores: clip full pages, right-click images, X posts & selections",
          icon: "bx:bx-extension",
          color: "from-emerald-600/10 to-green-500/5",
        },
        {
          tag: "Visual Diagrams",
          title: "Mind Maps, Flowcharts & Architectures",
          desc: "Native diagramming in notes with auto-layout, 1-prompt AI generation & vector export",
          icon: "bx:bx-sitemap",
          color: "from-teal-500/10 to-emerald-500/5",
        },
        {
          tag: "Local ACP Synergy",
          title: "Direct Local Agent Connection",
          desc: "Desktop connects directly via ACP to Codex, Antigravity, Claude Code, WorkBuddy, DeepSeek",
          icon: "bx:bxs-bot",
          color: "from-green-500/10 to-emerald-500/5",
        },
        {
          tag: "Companion Sidebar",
          title: "Persistent Sidebar & Text Selection Actions",
          desc: "Multi-chat switching with instant explain, translate, proofread & rewrite for selections",
          icon: "bx:bxs-brain",
          color: "from-emerald-500/10 to-teal-500/5",
        },
        {
          tag: "Docker Deploy",
          title: "VPS & NAS 1-Line Install",
          desc: "Fast curl deployment with scalable storage, supporting local disks and S3 buckets",
          icon: "bx:bxl-docker",
          color: "from-teal-600/10 to-emerald-600/5",
        },
        {
          tag: "Creator Styling",
          title: "Styled Copy & Custom Note CSS",
          desc: "One-click styled copy for newsletters; customize font size, line height & light/dark CSS",
          icon: "bx:bx-copy",
          color: "from-emerald-500/10 to-teal-500/5",
        },
        {
          tag: "Data Sovereignty",
          title: "Lossless ZIP Archive",
          desc: "Standard SQLite with lossless export of Markdown, attachments & revision history",
          icon: "bx:bx-archive",
          color: "from-green-600/10 to-teal-500/5",
        },
      ],
    },
    features: {
      heading: "A personal notes workspace rebuilt for self-hosting",
      items: [
        {
          title: "Flexible Deployment: Cloudflare Serverless & Docker",
          summary: "The same modern application runs seamlessly on Cloudflare Serverless or on a VPS, NAS, or home server via Docker.",
          points: [
            "Cloudflare Free-Tier Self-Hosting: No VPS rental or SSL certificates required. Personal use typically supports about 150k notes and 50k images.",
            "1-Line Docker Deployment: Quick deployment with a single curl command, scaling easily to millions of notes and large files.",
            "Complete Data Privacy: Regardless of deployment method, all your data lives strictly within your own account or private hardware.",
          ],
        },
        {
          title: "Dual AI Synergy: Companion Sidebar, Local ACP Agents & Remote MCP",
          summary: "Built-in REST API, Remote MCP endpoint, and desktop ACP protocol turn AI into a true copilot for your knowledge base.",
          points: [
            "Desktop ACP Local Agent Connection: Connect directly to local agents such as Codex, Antigravity, Claude Code, WorkBuddy, DeepSeek Harness with zero latency.",
            "Persistent AI Companion Sidebar: Switch between multiple chat threads and instantly explain, translate, proofread, and polish selected text.",
            "Built-in Remote MCP Endpoint: Authorize external AI assistants to safely read, create, and organize notes across your workflows.",
            "Connect Your Own AI Models: Support for OpenAI, Anthropic Claude, Google Gemini, DeepSeek, and custom compatible endpoints.",
          ],
        },
        {
          title: "Classic Three-Pane Workflow, Focus Mode & Appearance",
          summary: "Preserves the classic three-pane productivity workflow (Tree View · Note List · Editor) while supporting rich text, Markdown source, and custom appearance presets.",
          points: [
            "Unlimited nested notebooks for long-term personal knowledge bases.",
            "Full-screen focus mode on desktop, drag-and-drop notebook reordering, and multi-note batch move or merge.",
            "Independent font size, line height, and palette settings with light/dark custom CSS presets and side-by-side preview.",
          ],
        },
        {
          title: "Visual Diagram Notes & Creator Tools",
          summary: "Native mind maps, flowcharts, and architecture diagrams inside notes, combined with styled rich copy, Mermaid, and math formulas.",
          points: [
            "Visual Diagram Notes: Create mind maps, flowcharts, and architecture diagrams natively with one-prompt AI generation and vector export.",
            "One-Click Styled Copy: Instantly converts Markdown into styled HTML with inline CSS for Substack, Medium, or newsletters.",
            "Native Mermaid & KaTeX: Render architecture diagrams, flowcharts, and mathematical equations with editable source code.",
            "PDF Preview & Universal Attachments: Preview PDF documents inline, and attach Office files, archives, and multimedia easily.",
          ],
        },
        {
          title: "Apps Across Platforms & Multi-Device Sync",
          summary: "Available across macOS, Windows, iOS, Android, browser Web Clipper, and Web/PWA, freeing you from commercial device caps.",
          points: [
            "Unlimited Devices: Self-hosted API eliminates commercial restrictions like the '2-device login limit'.",
            "macOS Desktop App: Electron + Rust sidecar + SQLite for blazing fast local performance, ACP synergy, and offline sync.",
            "Windows x64: Local SQLite, Explorer right-click 'Send to Ponder', and automatic updates.",
            "Mobile Native Apps: Native SwiftUI iOS App (on App Store) and Android App (on Google Play & GitHub APK) with undo/redo and WeChat clipping.",
            "Web Clipper Extension: Official extensions on Chrome, Edge, and Firefox for full articles, right-click images, X posts, and selections.",
          ],
        },
        {
          title: "Open Data, Multi-Account Isolation & Lossless Migration",
          summary: "Standard SQLite storage, multi-account isolation per instance, lossless ZIP archives, and easy migration tools.",
          points: [
            "Multi-Account Workspaces: Single instance supports multiple isolated user spaces for family or small teams.",
            "Lossless ZIP Backup: One-click export including Markdown, Front Matter, nested notebooks, attachments, and revision history.",
            "Seamless Migration: Built-in migration scripts and guides for Evernote (ENEX), Memos, Notion, and Flomo.",
            "Client-Side Image Compression: Compresses images before upload (50%-90% size reduction) for faster loading and storage savings.",
          ],
        },
      ],
    },
    guides: {
      eyebrow: "Ponder Guides",
      heading: "Deploy, migrate, and put AI agents to work",
      description: "The fastest paths into Ponder: deploy your own instance, move an existing Evernote archive, then connect MCP-powered AI workflows.",
      items: [
        {
          title: "Choose how to deploy Ponder",
          summary: "Use an AI Agent or manual setup for Cloudflare, or run a one-line Docker installer on a VPS or NAS.",
          href: "/blog/ai-agent-deploy-cloudflare",
          cta: "Read deployment guide",
        },
        {
          title: "Migrate from Evernote",
          summary: "Use Ponder MCP, evernote-backup, and the ENEX import script to migrate an old notes library into your self-hosted instance.",
          href: "/blog/evernote-migration-guide",
          cta: "Read migration guide",
        },
        {
          title: "19 Real-World Workflows",
          summary: "Visual walkthrough of three-pane editing, omnichannel clipping, AI diagrams & databases, local ACP agents, and poster design.",
          href: "/guides/best-practices",
          cta: "View showcase",
        },
        {
          title: "AI Agent advanced play",
          summary: "Turn real notes into knowledge maps, tag cleanup plans, and higher-level personal knowledge workflows through MCP.",
          href: "/guides/advanced-play",
          cta: "Explore workflows",
        },
      ],
    },
  },
  ja: jaSiteCopy,
  pl: plSiteCopy,
} as const;
