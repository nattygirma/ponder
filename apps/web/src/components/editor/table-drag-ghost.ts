import type { TableAxis } from "@/lib/editor-table-actions";

/**
 * The see-through copy of a row or column that follows the pointer while it is dragged by its
 * six-dot handle, as in Notion. It is a fixed-position clone of the row's or column's cells inside
 * shallow copies of the editor and table wrappers, so the table's own styles apply to it.
 */
export type TableDragGhost = {
  /** Move the copy by `offset` pixels along the drag axis from where it started. */
  move: (offset: number) => void;
  remove: () => void;
};

type GhostBox = { left: number; top: number; width: number; height: number };

/**
 * `cells` are the DOM cells of the dragged line, top to bottom for a column or left to right for a
 * row; a merged cell appears once. `box` is the line's box on screen and `limits` the table's, so
 * the copy never leaves the table.
 */
export const createTableDragGhost = (
  table: HTMLTableElement,
  axis: TableAxis,
  cells: HTMLElement[],
  box: GhostBox,
  limits: GhostBox,
): TableDragGhost | null => {
  if (!cells.length || box.width <= 0 || box.height <= 0) return null;
  const doc = table.ownerDocument;
  const editorRoot = table.closest(".ProseMirror");
  const wrapper = table.closest(".tableWrapper");

  const ghostTable = table.cloneNode(false) as HTMLTableElement;
  ghostTable.style.width = `${box.width}px`;
  ghostTable.style.minWidth = "";
  ghostTable.style.tableLayout = "fixed";
  const colgroup = doc.createElement("colgroup");
  const body = doc.createElement("tbody");
  if (axis === "row") {
    const row = doc.createElement("tr");
    for (const cell of cells) {
      const width = cell.getBoundingClientRect().width;
      const col = doc.createElement("col");
      col.style.width = `${width}px`;
      colgroup.appendChild(col);
      row.appendChild(copyCell(cell, width, box.height));
    }
    body.appendChild(row);
  } else {
    const col = doc.createElement("col");
    col.style.width = `${box.width}px`;
    colgroup.appendChild(col);
    for (const cell of cells) {
      const row = doc.createElement("tr");
      row.appendChild(copyCell(cell, box.width, cell.getBoundingClientRect().height));
      body.appendChild(row);
    }
  }
  ghostTable.appendChild(colgroup);
  ghostTable.appendChild(body);

  // Shallow copies of the editor root and table wrapper carry the classes the table's CSS needs.
  let content: HTMLElement = ghostTable;
  if (wrapper) {
    const wrapperCopy = wrapper.cloneNode(false) as HTMLElement;
    wrapperCopy.style.overflow = "visible";
    wrapperCopy.style.margin = "0";
    wrapperCopy.style.padding = "0";
    wrapperCopy.appendChild(content);
    content = wrapperCopy;
  }
  if (editorRoot) {
    const rootCopy = editorRoot.cloneNode(false) as HTMLElement;
    rootCopy.removeAttribute("contenteditable");
    rootCopy.removeAttribute("id");
    rootCopy.setAttribute("aria-hidden", "true");
    rootCopy.style.padding = "0";
    rootCopy.style.margin = "0";
    rootCopy.style.minHeight = "0";
    rootCopy.appendChild(content);
    content = rootCopy;
  }

  const ghost = doc.createElement("div");
  ghost.className = "ponder-table-ghost";
  ghost.setAttribute("aria-hidden", "true");
  const font = doc.defaultView?.getComputedStyle(table);
  Object.assign(ghost.style, {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    font: font?.font ?? "",
    color: font?.color ?? "",
  });
  ghost.appendChild(content);
  doc.body.appendChild(ghost);

  // Keep the copy inside the table, as Notion does.
  const min = axis === "row" ? limits.top - box.top : limits.left - box.left;
  const max = axis === "row"
    ? limits.top + limits.height - (box.top + box.height)
    : limits.left + limits.width - (box.left + box.width);
  // A wide table scrolls sideways inside its wrapper: hide the part of the copy outside it.
  const visible = wrapper?.getBoundingClientRect();
  const clip = (shift: number) => {
    if (!visible) return;
    const left = Math.max(0, visible.left - (box.left + shift));
    const right = Math.max(0, box.left + shift + box.width - visible.right);
    ghost.style.clipPath = left || right ? `inset(0 ${right}px 0 ${left}px)` : "";
  };
  clip(0);
  return {
    move: (offset) => {
      const clamped = Math.min(Math.max(offset, min), Math.max(min, max));
      ghost.style.transform = axis === "row" ? `translate3d(0, ${clamped}px, 0)` : `translate3d(${clamped}px, 0, 0)`;
      clip(axis === "row" ? 0 : clamped);
    },
    remove: () => ghost.remove(),
  };
};

const copyCell = (cell: HTMLElement, width: number, height: number) => {
  const copy = cell.cloneNode(true) as HTMLElement;
  copy.removeAttribute("rowspan");
  copy.removeAttribute("colspan");
  copy.classList.remove("selectedCell");
  copy.style.width = `${width}px`;
  copy.style.height = `${height}px`;
  copy.querySelectorAll("[contenteditable]").forEach((element) => element.removeAttribute("contenteditable"));
  copy.querySelectorAll(".column-resize-handle").forEach((element) => element.remove());
  return copy;
};
