# Firefox Add-ons Submission

## Listing

- Name: Ponder Web Clipper
- Summary: Save webpages, selections, images, and Hacker News posts to your self-hosted Ponder instance.
- Category: Bookmarks
- Homepage: https://appkeep.io
- Support: https://github.com/tianma-if/edgeever/issues
- Privacy policy: https://appkeep.io/privacy

## Description

Ponder Web Clipper saves the current webpage, selected text, a right-clicked image, an X post, a Reddit post, a Xiaohongshu note, a Zhihu answer or article, or a GitHub repository's address and description directly to the self-hosted Ponder instance you configure.

- Extract readable article content, or right-click selected text and save that passage only.
- Right-click an image and save that image file as a new note. From Google Search, the note records Google Search and the keyword.
- On X, right-click the post text and save the full post, including text behind Show more, plus photos already shown.
- On Xiaohongshu, right-click the note text and save the title, text, and photos. Comments are left out.
- On Zhihu, right-click the answer or article text and save the title, author, text, and photos. Comments are left out. On a feed or question page, the item under the pointer is saved.
- On Reddit, right-click a post and save its title, author, community, text, links, and images. Comments are left out.
- On a GitHub repository page or code tree, right-click the page background, the description, or the README text and save the repository address and description.
- On Hacker News post detail pages, save the title, author, original time, points at capture, linked page and main-post text. Comments are left out.
- On a YouTube or Bilibili watch page, save that video as a note.
- These commands stay on the top-level right-click menu.
- Convert captured HTML to Markdown locally.
- Choose a default Ponder notebook.
- Send content directly to your instance without a Ponder-operated relay.
- No advertising, analytics, tracking, or telemetry.

Before using the extension, enter your Ponder instance URL and API token in the extension settings. The extension reads and sends page content only after you choose a clip or save command, including **Save Reddit post to Ponder**.

## Data collection and transmission

- `authenticationInfo`: the API token is sent only to the Ponder instance configured by the user.
- `browsingActivity`: the current page URL is included in the note created by the user.
- `websiteContent`: the selected text, extracted article body, image file, or video page the user chooses is included in the note created by the user.

The project maintainers do not receive or retain this data. Instance settings are stored in the browser's local extension storage. Page content goes only to the Ponder instance the user configured. When the token includes `ai:generate` and the workspace has a default model, that instance sends the caption text to the configured model provider. The extension does not send the page or its audio to any other third party.

## Reviewer notes

1. Open the extension settings.
2. Enter the provided review Ponder instance URL and API token.
3. Choose **Test connection**, select a notebook, and save.
4. Open a normal HTTP or HTTPS webpage.
5. Open the extension, choose **Clip current page**, and verify that the success message appears.
6. On a normal webpage, select a passage, right-click it, choose **Save selection to Ponder**, and verify the note contains that passage and the page link.
7. On a normal webpage, right-click an image, choose **Save image to Ponder**, and verify the new note contains the image.
8. Open one X post page, right-click the post text (not a photo), choose **Save post to Ponder**, and verify the note contains the post text and the post link.
9. Open one GitHub repository page, right-click the description or README text, choose **Save repository info to Ponder**, and verify the note contains the repository address and description.
10. Open one Xiaohongshu note, right-click the note text (not a photo), choose **Save note to Ponder**, and verify the note contains the title, text, and source link.
11. Open one Zhihu answer or article, right-click the text (not a photo), choose **Save answer or article to Ponder**, and verify the note contains the title, text, and source link.
12. Open one Reddit post, right-click the post text, choose **Save Reddit post to Ponder**, and verify the note contains the title, author, community, and source link without comments.
13. Verify the created notes in the review Ponder instance.
14. Open a Hacker News post detail page and choose **Save Hacker News post to Ponder** or **Clip current page**. Verify the main post and source are saved without comments; a selected passage takes priority for the toolbar action.
15. On a YouTube or Bilibili watch page, right-click the page and choose **Save video note to Ponder**. The new menu runs only after that click. Lives and other unsupported pages show a message and create no note.

Restricted browser pages, extension stores, built-in PDF viewers, and other privileged pages cannot be captured.

## Reproducible build

Requirements:

- Bun 1.3.14 or later
- Node.js 20 or later, required by `web-ext`

Commands:

```sh
bun install --frozen-lockfile
bun run test:extension
bun run build:extension:firefox
bun run lint:extension:firefox
```

The reviewable source is the repository source before Vite bundling. Third-party packages are installed from the npm registry through the committed Bun lockfile.
