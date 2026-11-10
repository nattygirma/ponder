# Chrome Web Store listing

## Product details

- Name: `Ponder Web Clipper`
- Primary language: English
- Category: `Workflow & Planning`
- Homepage: `https://appkeep.io/`
- Support URL: `https://github.com/tianma-if/edgeever/issues`
- Privacy policy: `https://appkeep.io/privacy`

## Localized listings

- `English`: Localized listing

Select the matching language in the Chrome Web Store developer dashboard and enter the corresponding copy below. Store listing localization is separate from the extension's packaged `_locales` messages.

The detailed descriptions below include video notes and Hacker News capture prepared for the next store submission. The uploaded store package is still 0.1.9 until that version is submitted. An earlier draft stacked every site name in the opening sentence and repeated those names in the closing paragraph. Chrome Web Store rejected it immediately as excessive keywords (violation reference Yellow Argon). Keep each site in one feature line. The Japanese listing uses the English detailed description. The short summary still comes from the packaged `_locales` `extensionDescription`.

## Upload files

- Package: `store-assets/ponder-web-clipper-v0.1.9.zip`
- Store icon: `public/icons/icon-128.png`
- Screenshot: `store-assets/screenshot-options-1280x800.jpg`
- Small promo tile: `store-assets/promo-small-440x280.jpg`


### English

#### Summary

Save webpages, selections, images, and Hacker News posts to your self-hosted Ponder instance.

#### Detailed description

Ponder Web Clipper saves the current page, or the part of it you choose, to your self-hosted Ponder instance.

Key features:

- Extract article content automatically and convert it to searchable, editable Markdown.
- Select text, right-click, and choose “Save selection to Ponder” to store that passage only.
- Right-click an image and choose “Save image to Ponder” to store the image file as a new note.
- On X, right-click the post and save the expanded text with the photos already shown.
- On Xiaohongshu, save the note title, text, and photos. Comments are left out.
- On Zhihu, save the answer or article under the pointer, including its title, author, text, and photos. Comments are left out.
- On Reddit, right-click a post to save its title, author, community, text, links, and images. Comments are left out.
- On a GitHub repository page, save the address and description, plus the homepage, language, license, and topics when the page shows them.
- On Hacker News post detail pages, save the title, author, original time, points at capture, linked page and main-post text. Comments are left out.
- Save a YouTube or Bilibili watch page as a video note.
- These commands stay on the top-level right-click menu.
- The note keeps its source and the time it was clipped.
- Select a default notebook and add the web-clip tag automatically.
- The page is sent only to the Ponder instance you configure.

Before using the extension, enter your instance URL and API token in the extension settings. The extension reads the current tab only after you use a save command. It asks for access to an image's site only when that page cannot provide the image file.

Ponder is an open-source, self-hosted modern notes workspace. Project homepage and source code: https://github.com/tianma-if/edgeever

## Privacy practices

### Single purpose

Save the current webpage, user-selected text, a user-chosen image, one X post, one Reddit post, one Xiaohongshu note, one Zhihu answer or article, one GitHub repository card, one Hacker News post, or one video note from a supported watch page to the self-hosted Ponder instance explicitly configured by the user.

### Permission justifications

- `activeTab`: Read the active page only after the user clicks the extension's save action or chooses a save command for selected text, an image, an X post, a Reddit post, a Xiaohongshu note, a Zhihu item, a GitHub repository, a Hacker News post, or a supported watch page.
- `contextMenus`: Add one top-level item for the thing the user right-clicked: selected text, an image, an X post, a Reddit post, a Xiaohongshu note, a Zhihu answer or article, a GitHub repository page, or a Hacker News post detail page. The video-note item appears only on a supported YouTube or Bilibili watch page and runs only after the user clicks it.
- `scripting`: Inject the packaged capture script into the active page after the user initiates a capture.
- `storage`: Store the user's Ponder instance URL, API token, and default notebook ID locally.
- Optional host permissions: API calls go only to the Ponder instance the user approves. If a page cannot provide an image file, the extension asks for that image's site, or for all sites when the user chooses that option, and uses the access only to download the chosen image. Saving from an X or Xiaohongshu feed may ask for site access to identify the item under the pointer. On Zhihu and Reddit, a content script only remembers the item under the pointer. Its content is read after the user chooses the save command. If that listener is unavailable, the extension asks the user to right-click the same item again. The video-note command does not add a host permission. It runs in the page only after the user clicks it on a supported watch page.

Each permission justification field accepts at most 1,000 characters. The host text above is the 0.1.9 wording plus the video-note sentence. It stays under that cap and has not been submitted.

### Data disclosures

The extension handles authentication information, website content, and web browsing activity. These data are used only for the user-triggered clipping feature. Page content is processed locally and sent directly to the user's configured Ponder instance. When the token includes `ai:generate` and the workspace has a default model, that instance sends the caption text to the configured model provider. The extension does not send the page or its audio to any other third party. The developer does not receive or retain it.

- Data is not sold or transferred to third parties outside the approved use case.
- Data is not used for purposes unrelated to the extension's single purpose.
- Data is not used for creditworthiness or lending.
- No remote code is used.

## Distribution

- Visibility: Public
- Regions: All regions supported by the Chrome Web Store
- Defer publish: Off, unless a manual launch date is desired
