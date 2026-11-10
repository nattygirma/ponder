// Content script for xiaohongshu.com. It only remembers which note was under
// the pointer so a later menu click can save that post. No imports: content
// scripts are classic scripts, and this file is also injected again after the
// user grants access.
(() => {
  const root = globalThis as typeof globalThis & { __ponderXhsTarget?: boolean };
  if (root.__ponderXhsTarget) return;
  root.__ponderXhsTarget = true;

  // Keep identical to noteIdFromPath in xhs-clip.ts.
  const noteIdFromPath = (pathname: string) => {
    const direct = pathname.match(/^\/(?:explore|discovery\/item)\/([0-9a-fA-F]{16,32})(?=\/|$)/);
    if (direct?.[1]) return direct[1];
    const profile = pathname.match(/^\/user\/profile\/[^/]+\/([0-9a-fA-F]{16,32})(?=\/|$)/);
    return profile?.[1] ?? "";
  };

  const noteIdFromHref = (href: string) => {
    if (!href) return "";
    try {
      return noteIdFromPath(new URL(href, location.href).pathname);
    } catch {
      return "";
    }
  };

  document.addEventListener("contextmenu", (event) => {
    const rawTarget = event.target;
    const element = rawTarget instanceof Element
      ? rawTarget
      : rawTarget instanceof Node
        ? rawTarget.parentElement
        : null;
    if (!element) return;
    for (const node of document.querySelectorAll("[data-ponder-xhs-target]")) {
      node.removeAttribute("data-ponder-xhs-target");
      node.removeAttribute("data-ponder-xhs-note-id");
    }
    const detail = element.closest("#noteContainer");
    const card = detail ? null : element.closest("section.note-item, .note-item");
    const target = detail || card;
    if (!target) return;
    target.setAttribute("data-ponder-xhs-target", "1");
    const href = target.querySelector("a[href]")?.getAttribute("href") || "";
    const noteId = noteIdFromHref(href) || noteIdFromPath(location.pathname);
    if (noteId) target.setAttribute("data-ponder-xhs-note-id", noteId);
  }, true);
})();
