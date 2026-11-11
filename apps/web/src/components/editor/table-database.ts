import type { Editor } from "@tiptap/react";
import type { DatabaseProperty, DatabasePropertyValue } from "@ponder/shared";
import { api } from "@/lib/api";
import { tableToDatabase } from "@/lib/editor-table-actions";

/**
 * Notion's "Turn into database" for a simple table: a database inside this page whose properties
 * are the header row's text (all Text), with one row per table row. The table is replaced by the
 * database only once every row is saved, so a failure leaves the table as it was.
 */
export const turnTableIntoDatabase = async ({ editor, tablePos, pageId, columnName }: {
  editor: Editor;
  tablePos: number;
  pageId: string;
  columnName: (index: number) => string;
}) => {
  const table = editor.state.doc.nodeAt(tablePos);
  if (!table || table.type.name !== "table") return false;
  const { columns, rows } = tableToDatabase(table, columnName);
  const { database } = await api.createDatabase({ parentId: pageId });
  const titleProperty = database.schema.properties.find((property) => property.type === "title");
  if (!titleProperty) throw new Error("The new database has no title property");
  const properties: DatabaseProperty[] = columns.map((name, index) => index === 0
    ? { ...titleProperty, name }
    : { id: `prop_${index}`, name, type: "text" } as DatabaseProperty);
  await api.updateDatabase(database.id, { schema: { ...database.schema, properties } });
  for (const row of rows) {
    const values: Record<string, DatabasePropertyValue> = {};
    row.slice(1).forEach((value, index) => {
      if (value) values[`prop_${index + 1}`] = value;
    });
    await api.createDatabaseRow(database.id, { title: (row[0] ?? "").slice(0, 160), properties: values });
  }
  // The table may have moved while rows were saved; find it again by identity.
  let at: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (at !== null) return false;
    if (node === table) at = pos;
    return at === null;
  });
  const position = at ?? (editor.state.doc.nodeAt(tablePos) === table ? tablePos : null);
  if (position === null) return false;
  editor.chain().focus().insertContentAt(
    { from: position, to: position + table.nodeSize },
    { type: "ponderDatabase", attrs: { databaseId: database.id, viewId: database.views[0]?.id ?? "" } },
  ).run();
  return true;
};
