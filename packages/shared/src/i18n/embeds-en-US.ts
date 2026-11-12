/**
 * Text for Notion's Embed block and named embeds (Phase E of the Notion blocks plan). The service
 * names are in `embed-services.ts`; where Notion's own wording for a service is known it is here,
 * and the rest use the generic lines with the service's name.
 */
export const embedsEnUS = {
  menuLabel: "Embed",
  generic: {
    add: "Embed anything (PDFs, Google Docs, Google Maps, Spotify…)",
    placeholder: "Paste in https://…",
    submit: "Embed link",
    hint: "Works with links of PDFs, Google Drive, Google Maps, CodePen…",
  },
  add: "Embed {{name}}",
  submit: "Embed link",
  hint: "Works with links to {{name}}",
  bookmarkSubmit: "Link",
  bookmarkHint: "Shows {{name}} links as a preview card",
  uploadChoose: "Choose a file",
  invalidLink: "This link doesn't look like a {{name}} link.",
  checking: "Embedding…",
  frameTitle: "{{name}} embed",
  resizeLeft: "Resize from the left",
  resizeRight: "Resize from the right",
  resizeBottom: "Resize height",
  resizeCorner: "Resize",
  openOriginal: "Open original",
  sameSite: "Pages from this site can't be embedded. Open the link instead.",
  services: {
    googleMaps: { add: "Embed a Google Map", submit: "Embed Map", hint: "Works with places on Google Maps" },
    tweet: { add: "Embed a Tweet from X", submit: "Embed Tweet", hint: "Works with links to Tweets" },
    githubGist: { add: "Embed a Gist", submit: "Embed Gist", hint: "Works with links to Gists on GitHub" },
    miro: { add: "Embed Miro", submit: "Embed Miro", hint: "Works with Miro links with public access enabled" },
    codepen: { add: "Embed CodePen", submit: "Embed link", hint: "Works with any public CodePen link…" },
    googleDrive: { add: "Embed Google Drive", submit: "Embed link", hint: "Works with files, docs, sheets, slides and folders shared publicly" },
    pdf: { add: "Embed a PDF", submit: "Embed PDF", hint: "Works with links that end in .pdf" },
    figma: { add: "Embed Figma", submit: "Embed Figma", hint: "Works with Figma files, prototypes and boards anyone with the link can view" },
    loom: { add: "Embed Loom", submit: "Embed Loom", hint: "Works with links to Loom videos" },
  },
} as const;
