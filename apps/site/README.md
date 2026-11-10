# Ponder Website

This directory is the official **Ponder** website, inside the monorepo at `apps/site`.

> **Ponder: a free, open-source, self-hosted Evernote alternative on Cloudflare with native AI Agent access.**
>
> Core repository: [GitHub - tianma-if/edgeever](https://github.com/tianma-if/edgeever)
>
> Website: [https://appkeep.io](https://appkeep.io) (demo: [https://appkeep.io](https://appkeep.io))

## Tech stack

- **Framework**: [Astro v5](https://astro.build/) (static site generation)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/)
- **Content**: Astro Content Collections (guides and logs written in Markdown)

## Development and build

### 1. Install dependencies

From the repository root:

```bash
bun install
```

### 2. Start the dev server

```bash
bun run dev:site
```

### 3. Build the static site

```bash
bun run build:site
```

Output goes to `apps/site/dist/`.

### 4. Preview the build locally

```bash
bun run preview:site
```

## Directory structure

- `src/pages/`: main site pages (home, contact, development log).
- `src/components/`: reusable UI and section components.
- `src/content/blog/`: technical guides and release logs for the project (Markdown).
- `public/`: static images, icons and robots.txt.
