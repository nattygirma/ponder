// Rows just made with "+ New", whose name opens for typing when they first show, as in Notion.
const titleEditsOnShow = new Set<string>();

export const editTitleWhenShown = (rowId: string) => {
  titleEditsOnShow.add(rowId);
};

/** True once for a row that asked for it; later calls return false. */
export const takeTitleEdit = (rowId: string) => titleEditsOnShow.delete(rowId);
