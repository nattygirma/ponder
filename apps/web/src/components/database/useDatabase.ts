import { useCallback, useMemo, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  computeRowValues,
  DATABASE_ROW_LIMIT,
  type ComputedCell,
  type DatabaseDetail,
  type DatabasePropertyValue,
  type DatabaseRow,
  type DatabaseSchema,
  type DatabaseView,
  type DatabaseViewConfig,
  type DatabaseTemplate,
  type DatabaseViewType,
  withValidRelationPairs,
} from "@ponder/shared";
import { api } from "@/lib/api";
import { useWorkspaceMembers } from "@/components/comments/PageComments";

export const databaseKey = (id: string) => ["database", id] as const;
export const databaseRowsKey = (id: string) => ["database-rows", id] as const;
export const rowContextKey = (memoId: string) => ["database-row-context", memoId] as const;

const fetchAllRows = async (id: string) => {
  const rows: DatabaseRow[] = [];
  let cursor: string | null = null;
  do {
    const page: { rows: DatabaseRow[]; nextCursor: string | null } = await api.listDatabaseRows(id, { cursor, limit: 500 });
    rows.push(...page.rows);
    cursor = page.nextCursor;
  } while (cursor && rows.length < DATABASE_ROW_LIMIT);
  return rows;
};

export const useRowContext = (memoId: string, enabled = true) =>
  useQuery({
    queryKey: rowContextKey(memoId),
    queryFn: async () => (await api.getDatabaseRowContext(memoId)).context,
    enabled,
    staleTime: 15_000,
  });

export type DatabaseHandle = {
  database: DatabaseDetail;
  rows: DatabaseRow[];
  cells: Map<string, Record<string, ComputedCell>>;
  related: Map<string, { database: DatabaseDetail; rows: DatabaseRow[] }>;
  /** Workspace members' names by user id, for person values. */
  people: ReadonlyMap<string, string>;
  error: string | null;
  clearError: () => void;
  rename: (title: string) => Promise<void>;
  /** Changes the schema. Fields left out (sub-items, dependencies) keep their current value. */
  updateSchema: (schema: Partial<DatabaseSchema>) => Promise<void>;
  addRow: (input?: { title?: string; properties?: Record<string, DatabasePropertyValue>; templateId?: string }) => Promise<DatabaseRow | null>;
  saveTemplate: (templateId: string | null, input: TemplateInput) => Promise<DatabaseTemplate | null>;
  deleteTemplate: (templateId: string) => Promise<void>;
  updateRow: (rowId: string, input: { title?: string; properties?: Record<string, DatabasePropertyValue> }) => Promise<void>;
  moveRow: (rowId: string, anchor: { beforeId?: string; afterId?: string }) => Promise<void>;
  deleteRow: (rowId: string) => Promise<void>;
  addView: (input: { name: string; type: DatabaseViewType; config?: DatabaseViewConfig }) => Promise<DatabaseView | null>;
  updateView: (viewId: string, input: { name?: string; type?: DatabaseViewType; config?: DatabaseViewConfig }) => Promise<void>;
  deleteView: (viewId: string) => Promise<void>;
};

export type TemplateInput = Partial<Pick<DatabaseTemplate, "name" | "icon" | "title" | "properties" | "content" | "isDefault">>;

const errorText = (error: unknown) => (error instanceof Error && error.message ? error.message : "Something went wrong.");

export const useDatabase = (databaseId: string) => {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: databaseKey(databaseId),
    queryFn: async () => (await api.getDatabase(databaseId)).database,
    enabled: Boolean(databaseId),
  });
  const rowsQuery = useQuery({
    queryKey: databaseRowsKey(databaseId),
    queryFn: () => fetchAllRows(databaseId),
    enabled: Boolean(databaseId),
  });

  const relatedIds = useMemo(
    () => [...new Set((detail.data?.schema.properties ?? []).flatMap((property) => (
      property.type === "relation" && property.relation && property.relation.databaseId !== databaseId ? [property.relation.databaseId] : []
    )))],
    [databaseId, detail.data?.schema.properties],
  );
  const relatedDetails = useQueries({
    queries: relatedIds.map((id) => ({ queryKey: databaseKey(id), queryFn: async () => (await api.getDatabase(id)).database })),
  });
  const relatedRows = useQueries({
    queries: relatedIds.map((id) => ({ queryKey: databaseRowsKey(id), queryFn: () => fetchAllRows(id) })),
  });
  const relatedStamp = relatedRows.map((query) => query.dataUpdatedAt).join(",") + relatedDetails.map((query) => query.dataUpdatedAt).join(",");

  const related = useMemo(() => {
    const map = new Map<string, { database: DatabaseDetail; rows: DatabaseRow[] }>();
    relatedIds.forEach((id, index) => {
      const database = relatedDetails[index]?.data;
      const rows = relatedRows[index]?.data;
      if (database && rows) map.set(id, { database, rows });
    });
    if (detail.data && rowsQuery.data) map.set(databaseId, { database: detail.data, rows: rowsQuery.data });
    return map;
    // The query arrays are new on every render; the stamp changes only when their data does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [databaseId, detail.data, relatedIds, relatedStamp, rowsQuery.data]);

  const usesPeople = (detail.data?.schema.properties ?? []).some((property) => (
    property.type === "person" || property.type === "created_by" || property.type === "last_edited_by"
  ));
  const members = useWorkspaceMembers(usesPeople);
  const people = useMemo(
    () => new Map((members.data ?? []).map((member) => [member.id, member.displayName || member.username])),
    [members.data],
  );

  const cells = useMemo(() => {
    if (!detail.data || !rowsQuery.data) return new Map<string, Record<string, ComputedCell>>();
    const relatedRows = Object.fromEntries(
      [...related].map(([id, entry]) => [id, { schema: entry.database.schema, rows: entry.rows }]),
    );
    return computeRowValues({ schema: detail.data.schema, rows: rowsQuery.data, relatedRows, now: new Date(), people });
  }, [detail.data, people, related, rowsQuery.data]);

  const patchRows = useCallback((update: (rows: DatabaseRow[]) => DatabaseRow[]) => {
    queryClient.setQueryData<DatabaseRow[]>(databaseRowsKey(databaseId), (current) => (current ? update(current) : current));
  }, [databaseId, queryClient]);

  const patchDetail = useCallback((update: (database: DatabaseDetail) => DatabaseDetail) => {
    queryClient.setQueryData<DatabaseDetail>(databaseKey(databaseId), (current) => (current ? update(current) : current));
  }, [databaseId, queryClient]);

  const resync = useCallback(() => Promise.all([
    queryClient.invalidateQueries({ queryKey: databaseKey(databaseId) }),
    queryClient.invalidateQueries({ queryKey: databaseRowsKey(databaseId) }),
  ]), [databaseId, queryClient]);

  /** Runs a save whose result was already shown; a failure puts the server's state back and says so. */
  const attempt = useCallback(async <T,>(work: () => Promise<T>): Promise<T | null> => {
    try {
      setError(null);
      return await work();
    } catch (cause) {
      setError(errorText(cause));
      await resync();
      return null;
    }
  }, [resync]);

  const handle = useMemo<DatabaseHandle | null>(() => {
    if (!detail.data || !rowsQuery.data) return null;
    return {
      database: detail.data,
      rows: rowsQuery.data,
      cells,
      related,
      people,
      error,
      clearError: () => setError(null),
      rename: async (title) => {
        patchDetail((database) => ({ ...database, title }));
        await attempt(() => api.updateDatabase(databaseId, { title }));
        void queryClient.invalidateQueries({ queryKey: ["page-tree"] });
      },
      updateSchema: async (patch) => {
        const schema = withValidRelationPairs({ ...detail.data!.schema, ...patch });
        patchDetail((database) => ({ ...database, schema }));
        await attempt(async () => {
          await api.updateDatabase(databaseId, { schema });
          // A two-way relation adds a property to the other database too.
          await queryClient.invalidateQueries({ queryKey: ["database"] });
        });
      },
      addRow: async (input) => attempt(async () => {
        const { row } = await api.createDatabaseRow(databaseId, input ?? {});
        patchRows((rows) => [...rows, row]);
        // A template or a sub-item can fill a two-way relation, which changes the rows on its other side too.
        const values = { ...detail.data?.templates.find((template) => template.id === input?.templateId)?.properties, ...input?.properties };
        const syncedRelation = detail.data?.schema.properties.some((property) => (
          property.type === "relation" && property.relation?.syncedPropertyId && property.id in values
        ));
        if (syncedRelation) await queryClient.invalidateQueries({ queryKey: ["database-rows"] });
        return row;
      }),
      updateRow: async (rowId, input) => {
        patchRows((rows) => rows.map((row) => (row.id === rowId
          ? {
            ...row,
            title: input.title ?? row.title,
            properties: input.properties ? { ...row.properties, ...input.properties } : row.properties,
          }
          : row)));
        await attempt(async () => {
          const { row } = await api.updateDatabaseRow(databaseId, rowId, input);
          patchRows((rows) => rows.map((current) => (current.id === rowId ? row : current)));
          queryClient.setQueryData(rowContextKey(rowId), (current: { database: DatabaseDetail; row: DatabaseRow } | null | undefined) => (
            current ? { ...current, row } : current
          ));
          const syncedRelation = input.properties && detail.data?.schema.properties.some((property) => (
            property.type === "relation" && property.relation?.syncedPropertyId && property.id in input.properties!
          ));
          if (syncedRelation) await queryClient.invalidateQueries({ queryKey: ["database-rows"] });
        });
      },
      moveRow: async (rowId, anchor) => {
        patchRows((rows) => {
          const moving = rows.find((row) => row.id === rowId);
          if (!moving) return rows;
          const rest = rows.filter((row) => row.id !== rowId);
          const target = rest.findIndex((row) => row.id === (anchor.beforeId ?? anchor.afterId));
          if (target < 0) return rows;
          rest.splice(anchor.beforeId ? target : target + 1, 0, moving);
          return rest;
        });
        await attempt(() => api.updateDatabaseRow(databaseId, rowId, {
          beforeId: anchor.beforeId ?? null,
          afterId: anchor.afterId ?? null,
        }));
      },
      deleteRow: async (rowId) => {
        patchRows((rows) => rows.filter((row) => row.id !== rowId));
        await attempt(() => api.deleteMemo(rowId));
      },
      addView: async (input) => attempt(async () => {
        const { view } = await api.createDatabaseView(databaseId, input);
        patchDetail((database) => ({ ...database, views: [...database.views, view] }));
        return view;
      }),
      updateView: async (viewId, input) => {
        patchDetail((database) => ({
          ...database,
          views: database.views.map((view) => (view.id === viewId ? { ...view, ...input } : view)),
        }));
        await attempt(() => api.updateDatabaseView(databaseId, viewId, input));
      },
      saveTemplate: async (templateId, input) => attempt(async () => {
        const { template } = templateId
          ? await api.updateDatabaseTemplate(databaseId, templateId, input)
          : await api.createDatabaseTemplate(databaseId, { ...input, name: input.name ?? "" });
        patchDetail((database) => {
          const others = database.templates
            .filter((item) => item.id !== template.id)
            .map((item) => (template.isDefault ? { ...item, isDefault: false } : item));
          return { ...database, templates: [...others, template].sort((left, right) => left.position - right.position) };
        });
        return template;
      }),
      deleteTemplate: async (templateId) => {
        patchDetail((database) => ({ ...database, templates: database.templates.filter((item) => item.id !== templateId) }));
        await attempt(() => api.deleteDatabaseTemplate(databaseId, templateId));
      },
      deleteView: async (viewId) => {
        patchDetail((database) => ({ ...database, views: database.views.filter((view) => view.id !== viewId) }));
        await attempt(() => api.deleteDatabaseView(databaseId, viewId));
      },
    };
  }, [attempt, cells, databaseId, detail.data, error, patchDetail, patchRows, people, queryClient, related, rowsQuery.data]);

  return {
    handle,
    isLoading: detail.isLoading || rowsQuery.isLoading,
    failed: detail.isError || rowsQuery.isError,
    retry: resync,
  };
};
