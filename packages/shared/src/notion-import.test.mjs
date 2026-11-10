import { describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import { buildNotionPlan, NotionImportError, parseCsv, parseNotionDate, renderNotionBody, notionAssetRefs } from "./notion-import";

const A = "a".repeat(32), B = "b".repeat(32), C = "c".repeat(32), D = "d".repeat(32), E = "e".repeat(32), F = "f".repeat(32);
const inner = zipSync({
  [`Private & Shared/Home ${A}.md`]: strToU8(`# Home\n\nIntro with a [link](Home%20${A}/Child%20${B}.md).\n\n[Child](Home%20${A}/Child%20${B}.md)\n\n[Tasks](Home%20${A}/Tasks%20${C}.csv)\n\n<aside>\n💡 Remember this\n\n</aside>\n\n![pic](Home%20${A}/Untitled.png)\n\n\`\`\`\n[Child](Home%20${A}/Child%20${B}.md)\n\`\`\`\n`),
  [`Private & Shared/Home ${A}/Child ${B}.md`]: strToU8(`# Child\n\nBody of child`),
  [`Private & Shared/Home ${A}/Untitled.png`]: new Uint8Array([1, 2, 3]),
  [`Private & Shared/Home ${A}/Tasks ${C}.csv`]: strToU8(`﻿Name,Status,Due,Done,Points,Tags,Project\nFirst,In progress,"November 8, 2026",No,3,"a, b",Apollo\n"Second, with comma",Done,2026-11-09 → 2026-11-12,Yes,"1,200",a,Apollo\nThird,Not started,,No,,b,Zeus\n`),
  [`Private & Shared/Home ${A}/Tasks ${C}_all.csv`]: strToU8(`﻿Name,Status,Due,Done,Points,Tags,Project\nFirst,In progress,"November 8, 2026",No,3,"a, b",Apollo\n"Second, with comma",Done,2026-11-09 → 2026-11-12,Yes,"1,200",a,Apollo\nThird,Not started,,No,,b,Zeus\nHidden row,Done,,Yes,1,a,Zeus\n`),
  [`Private & Shared/Home ${A}/Tasks ${C}/First ${D}.md`]: strToU8(`# First\n\nStatus: In progress\nDue: November 8, 2026\nDone: No\n\nRow body: stays\n`),
  [`Private & Shared/Projects ${E}.csv`]: strToU8(`Name,Owner\nApollo,x@example.test\nZeus,y@example.test\n`),
  "__MACOSX/junk.md": strToU8("no"),
});
const archive = zipSync({ [`Part-1 ${F}.zip`]: inner });

describe("notion export plan", () => {
  const plan = buildNotionPlan(archive);
  const entry = (title) => plan.entries.find((item) => item.title === title);

  test("reads nested zips, pages and tree", () => {
    expect(entry("Home").parentKey).toBe(null);
    expect(entry("Child").parentKey).toBe(entry("Home").key);
    expect(entry("Tasks").kind).toBe("database");
    expect(entry("Tasks").parentKey).toBe(entry("Home").key);
    expect(plan.entries.some((item) => item.title === "junk")).toBe(false);
    expect(plan.entries.indexOf(entry("Home"))).toBeLessThan(plan.entries.indexOf(entry("Child")));
  });

  test("prefers the full table and types columns", () => {
    const tasks = entry("Tasks");
    expect(tasks.rows.length).toBe(4);
    const types = Object.fromEntries(tasks.columns.map((column) => [column.name, column.type]));
    expect(types).toEqual({ Name: "title", Status: "status", Due: "date", Done: "checkbox", Points: "number", Tags: "multi_select", Project: "relation" });
    expect(tasks.columns[6].relationTo).toBe(entry("Projects").key);
    expect(entry("Projects").columns[1].type).toBe("email");
    expect(tasks.rows[1].title).toBe("Second, with comma");
  });

  test("links row pages to rows and strips repeated properties", () => {
    const row = entry("First");
    expect(row.rowOf).toBe(entry("Tasks").key);
    expect(entry("Tasks").rows[0].pageKey).toBe(row.key);
    expect(row.markdown.trim()).toBe("Row body: stays");
  });

  test("rewrites links, child blocks, callouts and files, not code", () => {
    const home = entry("Home");
    expect(notionAssetRefs(home, plan.assets).length).toBe(1);
    const targets = {
      byKey: new Map([
        [entry("Child").key, { memoId: "m_child", title: "Child", parentKey: home.key }],
        [entry("Tasks").key, { memoId: "m_tasks", databaseId: "db_tasks", title: "Tasks", parentKey: home.key }],
      ]),
      byNotionId: new Map(),
      assetUrls: new Map([[notionAssetRefs(home, plan.assets)[0], "/r/pic.png"]]),
    };
    const body = renderNotionBody(home, targets, (id) => `#memo=${id}`);
    expect(body).toContain("Intro with a [link](#memo=m_child).");
    expect(body).toContain('<ponder-page id="m_child">Child</ponder-page>');
    expect(body).toContain('<ponder-database id="db_tasks"></ponder-database>');
    expect(body).toContain('<ponder-callout icon="💡" color="gray">');
    expect(body).toContain("![pic](/r/pic.png)");
    expect(body).toContain(`\`\`\`\n[Child](Home%20${A}/Child%20${B}.md)\n\`\`\``);
  });

  test("reads newer exports whose folders have no ids", () => {
    // The layout of a real 2026 export: "Task List <id>.csv" with its row pages in "Task List/".
    const newer = buildNotionPlan(zipSync({
      [`Task List ${A}.csv`]: strToU8("﻿Name\n\nTake Fig on a walk\n"),
      [`Task List ${A}_all.csv`]: strToU8("﻿Name,Date Created,Status\n,\"October 17, 2021 7:15 AM\",\nTake Fig on a walk,\"October 17, 2021 7:15 AM\",Doing\n"),
      [`Task List/Take Fig on a walk ${B}.md`]: strToU8("# Take Fig on a walk\n\nDate Created: October 17, 2021 7:15 AM\nStatus: Doing\n"),
      [`Task List/New Task ${A.replace(/a/g, "9")}.md`]: strToU8("# New Task\n\nDate Created: October 17, 2021 7:15 AM\n\n# To Do\n"),
      [`Task List/Untitled ${C}.md`]: strToU8("# Untitled\n\nDate Created: October 17, 2021 7:15 AM\n\n# Tasks\n\n- [ ]  ...\n"),
      [`Home ${D}.md`]: strToU8("# Home\n"),
      [`Home/Child ${E}.md`]: strToU8("# Child\n"),
      [`Home/Child/Grandchild ${F}.md`]: strToU8("# Grandchild\n"),
    }));
    const find = (title) => newer.entries.find((item) => item.title === title);
    const tasks = find("Task List");
    expect(find("Take Fig on a walk").rowOf).toBe(tasks.key);
    expect(find("Untitled").rowOf).toBe(tasks.key);
    expect(tasks.rows.map((row) => [row.title, Boolean(row.pageKey)])).toEqual([["Untitled", true], ["Take Fig on a walk", true], ["New Task", true]]);
    // A page the table doesn't list keeps the properties written at its top.
    expect(tasks.rows[2].cells).toEqual(["New Task", "October 17, 2021 7:15 AM", ""]);
    expect(find("Child").parentKey).toBe(find("Home").key);
    expect(find("Grandchild").parentKey).toBe(find("Child").key);
  });

  test("a folder name two pages share is left unlinked rather than guessed", () => {
    const shared = buildNotionPlan(zipSync({
      [`Notes ${A}.md`]: strToU8("# Notes\n"),
      [`Notes ${B}.md`]: strToU8("# Notes\n"),
      [`Notes/Inside ${C}.md`]: strToU8("# Inside\n"),
    }));
    expect(shared.entries.find((item) => item.title === "Inside").parentKey).toBe(null);
  });

  test("rejects other files clearly", () => {
    expect(() => buildNotionPlan(strToU8("not a zip"))).toThrow(NotionImportError);
    expect(() => buildNotionPlan(zipSync({ "a.txt": strToU8("x") }))).toThrow(NotionImportError);
  });

  test("parses CSV and dates", () => {
    expect(parseCsv('a,"b ""q"", c"\r\n1,2\n')).toEqual([["a", 'b "q", c'], ["1", "2"]]);
    expect(parseNotionDate("November 8, 2026")).toEqual({ start: "2026-11-08" });
    expect(parseNotionDate("2026-11-09 → 2026-11-12")).toEqual({ start: "2026-11-09", end: "2026-11-12" });
    expect(parseNotionDate("soon")).toBe(null);
  });
});
