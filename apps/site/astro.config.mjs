import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import icon from "astro-icon";

import react from "@astrojs/react";

// https://astro.build/config
export default defineConfig({
  site: "https://appkeep.io",
  server: {
    port: 4321,
    host: "127.0.0.1"
  },
  integrations: [
    mdx(),
    sitemap({
      i18n: {
        defaultLocale: "en",
        locales: {
          en: "en-US",
          ja: "ja",
          pl: "pl",
        },
      },
    }),
    icon(),
    react(),
  ],
  redirects: {
    "/en": "/",
    "/en/blog": "/blog",
    "/en/blog/[slug]": "/blog/[slug]",
    "/en/contact": "/contact",
    "/en/data-deletion": "/data-deletion",
    "/en/docker-deploy": "/docker-deploy",
    "/en/guides/advanced-play": "/guides/advanced-play",
    "/en/guides/best-practices": "/guides/best-practices",
    "/en/manual-deploy": "/manual-deploy",
    "/en/privacy": "/privacy",
    "/en/self-hosted-evernote-alternative": "/self-hosted-evernote-alternative",
    "/guides/evernote-migration": "/blog/evernote-migration-guide",
    "/guides/memos-migration": "/blog/memos-migration-guide",
    "/guides/notion-migration": "/blog/notion-migration-guide",
    "/ja/guides/evernote-migration": "/blog/evernote-migration-guide",
    "/ja/guides/memos-migration": "/blog/memos-migration-guide",
    "/ja/guides/notion-migration": "/blog/notion-migration-guide",
    "/pl/guides/evernote-migration": "/blog/evernote-migration-guide",
    "/pl/guides/memos-migration": "/blog/memos-migration-guide",
    "/pl/guides/notion-migration": "/blog/notion-migration-guide",
  },
  vite: {
    plugins: [tailwindcss()],
    server: {
      fs: {
        allow: ["../.."],
      },
    },
  },
});