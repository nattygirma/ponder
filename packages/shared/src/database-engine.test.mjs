import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  FormulaError,
  applyDatabaseView,
  computeRowValues,
  evaluateFormula,
  groupRows,
  parseFormula,
} from "./database-engine.ts";

const NOW = new Date(2026, 2, 15, 14, 30, 45);

const run = (expression, properties = {}, now = NOW) => evaluateFormula(parseFormula(expression), {
  now,
  getProperty: (name) => (name in properties ? properties[name] : null),
});

const expectFormulaError = (action, pattern) => {
  let caught = null;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(FormulaError);
  if (pattern) expect(caught.message).toMatch(pattern);
  return caught;
};

const row = (id, title, properties = {}, extra = {}) => ({
  id,
  title,
  icon: null,
  excerpt: "",
  properties,
  position: 0,
  createdAt: "2026-01-02T03:04:05.000Z",
  updatedAt: "2026-01-03T03:04:05.000Z",
  ...extra,
});

const titleProperty = { id: "title", name: "Name", type: "title" };
const schemaOf = (...properties) => ({ properties: [titleProperty, ...properties] });
const compute = (schema, rows, relatedRows = {}) => computeRowValues({ schema, rows, relatedRows, now: NOW });

const statusOptions = [
  { id: "s_todo", name: "Todo", color: "gray", group: "todo" },
  { id: "s_doing", name: "Doing", color: "blue", group: "in_progress" },
  { id: "s_done", name: "Done", color: "green", group: "done" },
];
const tagOptions = [
  { id: "t_red", name: "Red", color: "red" },
  { id: "t_blue", name: "Blue", color: "blue" },
  { id: "t_green", name: "Green", color: "green" },
];

describe("formula parsing", () => {
  test("applies conventional precedence", () => {
    expect(run("1 + 2 * 3")).toBe(7);
    expect(run("(1 + 2) * 3")).toBe(9);
    expect(run("10 - 4 - 3")).toBe(3);
    expect(run("20 / 2 / 5")).toBe(2);
    expect(run("7 % 4 * 2")).toBe(6);
    expect(run("1 + 2 > 2 && 2 * 2 == 4")).toBe(true);
    expect(run("false && true || true")).toBe(true);
    expect(run("true || false && false")).toBe(true);
    expect(run("1 < 2 == true")).toBe(true);
  });

  test("makes ^ right-associative and tighter than unary minus", () => {
    expect(run("2 ^ 3 ^ 2")).toBe(512);
    expect(run("-2 ^ 2")).toBe(-4);
    expect(run("2 ^ -1")).toBe(0.5);
    expect(run("2 * 3 ^ 2")).toBe(18);
  });

  test("reads the ternary as right-associative and lowest", () => {
    expect(run("true ? 1 : false ? 2 : 3")).toBe(1);
    expect(run("false ? 1 : false ? 2 : 3")).toBe(3);
    expect(run("1 + 1 == 2 ? 'yes' : 'no'")).toBe("yes");
  });

  test("accepts word operators in any case and the matching functions", () => {
    expect(run("true and not false")).toBe(true);
    expect(run("false OR true")).toBe(true);
    expect(run("not (1 > 2)")).toBe(true);
    expect(run("not true or true")).toBe(true);
    expect(run("and(true, false)")).toBe(false);
    expect(run("or(false, true)")).toBe(true);
  });

  test("reads numbers, strings and lists", () => {
    expect(run("1.5e2")).toBe(150);
    expect(run(".5 + .5")).toBe(1);
    expect(run("'it\\'s'")).toBe("it's");
    expect(run('"a\\nb"')).toBe("a\nb");
    expect(run("[1, 'a', true, []]")).toEqual([1, "a", true, []]);
    expect(run("[]")).toEqual([]);
  });

  test("desugars method calls with the receiver first", () => {
    expect(parseFormula('"abc".length()')).toEqual({
      type: "call",
      name: "length",
      args: [{ type: "literal", value: "abc", position: 0 }],
      position: 6,
    });
    expect(run('"abc".length()')).toBe(3);
    expect(run('prop("Price").round()', { Price: 2.6 })).toBe(3);
    expect(run('prop("Price").round(1)', { Price: 2.66 })).toBe(2.7);
    expect(run("1.5.floor()")).toBe(1);
    expect(run("3.abs()")).toBe(3);
    expect(run('" Ab ".trim().lower().length()')).toBe(2);
    expect(run("[3, 1].sort().first()")).toBe(1);
    expect(run("2 + 3.pow(2)")).toBe(11);
  });

  test("treats function names case-insensitively", () => {
    expect(run('LENGTH("ab")')).toBe(2);
    expect(run("Round(1.4)")).toBe(1);
    expect(run('"a,b".SPLIT(",")')).toEqual(["a", "b"]);
    expect(run('replaceAll("aa", "a", "b")')).toBe("bb");
  });

  test("reports bad syntax with a position", () => {
    const error = expectFormulaError(() => parseFormula("1 + * 2"), /Unexpected "\*" at character 5/);
    expect(error.position).toBe(4);
    expectFormulaError(() => parseFormula("(1 + 2"), /Expected "\)"/);
    expectFormulaError(() => parseFormula("'open"), /closing quote/);
    expectFormulaError(() => parseFormula("1 = 2"), /use ==/);
    expectFormulaError(() => parseFormula("1 2"), /Unexpected "2"/);
    expectFormulaError(() => parseFormula(""), /end of the formula/);
    expectFormulaError(() => parseFormula("thisPage"), /Unknown name/);
    expectFormulaError(() => parseFormula("a.b"), /Unknown name/);
    expectFormulaError(() => parseFormula("1.abs"), /Expected "\("/);
    expectFormulaError(() => parseFormula("true ? 1"), /Expected ":"/);
  });

  test("rejects unknown functions and wrong argument counts while parsing", () => {
    expect(expectFormulaError(() => parseFormula("nope(1)"), /Unknown function "nope"/).position).toBe(0);
    expectFormulaError(() => parseFormula("constructor(1)"), /Unknown function/);
    expectFormulaError(() => parseFormula("abs()"), /abs expects 1 argument but got 0/);
    expectFormulaError(() => parseFormula("abs(1, 2)"), /abs expects 1 argument but got 2/);
    expectFormulaError(() => parseFormula("1.abs(2)"), /abs expects 1 argument but got 2/);
    expectFormulaError(() => parseFormula("round(1, 2, 3)"), /1 to 2 arguments/);
    expectFormulaError(() => parseFormula("min()"), /at least 1/);
    expectFormulaError(() => parseFormula("now(1)"), /now expects 0 arguments/);
  });

  test("re-checks calls during evaluation for hand-built trees", () => {
    const context = { now: NOW, getProperty: () => null };
    expectFormulaError(() => evaluateFormula({ type: "call", name: "nope", args: [], position: 0 }, context), /Unknown function/);
    expectFormulaError(() => evaluateFormula({ type: "call", name: "abs", args: [], position: 0 }, context), /abs expects/);
  });

  test("rejects nesting deeper than 64 and accepts 64", () => {
    const parens = (count) => `${"(".repeat(count)}1${")".repeat(count)}`;
    expect(run(parens(64))).toBe(1);
    expectFormulaError(() => parseFormula(parens(65)), /nested more than 64/);
    expectFormulaError(() => parseFormula(parens(100000)), /nested more than 64/);
    expectFormulaError(() => parseFormula(`${"[".repeat(65)}1${"]".repeat(65)}`), /nested/);
    expectFormulaError(() => parseFormula(`${"abs(".repeat(65)}1${")".repeat(65)}`), /nested/);
    expectFormulaError(() => parseFormula(`${"!".repeat(65)}true`), /nested/);
    expectFormulaError(() => parseFormula(`${"2^".repeat(70)}2`), /nested/);
    expectFormulaError(() => parseFormula(`1${".abs()".repeat(65)}`), /nested/);
    expectFormulaError(() => parseFormula(`${"true ? 1 : ".repeat(65)}2`), /nested/);
  });

  test("does not count a long flat chain as nesting", () => {
    expect(run(Array(500).fill("1").join(" + "))).toBe(500);
  });
});

describe("formula evaluation", () => {
  test("concatenates when either side of + is text", () => {
    expect(run('"a" + "b"')).toBe("ab");
    expect(run('"n=" + 1')).toBe("n=1");
    expect(run('1 + "n"')).toBe("1n");
    expect(run('"v:" + true')).toBe("v:true");
    expect(run('1 + 2 + "x"')).toBe("3x");
    expect(run('"x" + 1 + 2')).toBe("x12");
    expect(run('"sum " + (0.1 + 0.2)')).toBe("sum 0.3");
  });

  test("yields null for division by zero and for operations on null", () => {
    expect(run("1 / 0")).toBeNull();
    expect(run("1 % 0")).toBeNull();
    expect(run("divide(1, 0)")).toBeNull();
    expect(run("mod(1, 0)")).toBeNull();
    expect(run('prop("Missing") + 1')).toBeNull();
    expect(run('1 - prop("Missing")')).toBeNull();
    expect(run('"a" + prop("Missing")')).toBeNull();
    expect(run('-prop("Missing")')).toBeNull();
    expect(run('prop("Missing") > 1')).toBeNull();
    expect(run('lower(prop("Missing"))')).toBeNull();
    expect(run('round(prop("Missing"))')).toBeNull();
    expect(run('dateAdd(prop("Missing"), 1, "days")')).toBeNull();
    expect(run('length(prop("Missing"))')).toBeNull();
    expect(run("sqrt(-1)")).toBeNull();
    expect(run("10 ^ 999")).toBeNull();
  });

  test("keeps equality and logic total over null", () => {
    expect(run('prop("Missing") == prop("Other")')).toBe(true);
    expect(run('prop("Missing") == 1')).toBe(false);
    expect(run('prop("Missing") != 1')).toBe(true);
    expect(run('prop("Missing") && true')).toBe(false);
    expect(run('prop("Missing") || true')).toBe(true);
    expect(run('!prop("Missing")')).toBe(true);
    expect(run('prop("Missing") ? 1 : 2')).toBe(2);
  });

  test("raises FormulaError for mismatched types", () => {
    expectFormulaError(() => run('"a" - 1'), /Cannot use -/);
    expectFormulaError(() => run('true * 2'), /Cannot use \*/);
    expectFormulaError(() => run('1 < "a"'), /Cannot use </);
    expectFormulaError(() => run('-"a"'), /Cannot negate/);
    expectFormulaError(() => run('abs("a")'), /abs expects a number/);
    expectFormulaError(() => run('dateAdd(1, 1, "days")'), /expects a date/);
    expectFormulaError(() => run("prop(1)"), /prop expects text/);
  });

  test("covers logic functions and short-circuits", () => {
    expect(run('if(true, "a", "b")')).toBe("a");
    expect(run('if(false, 1 + "a" - 1, "b")')).toBe("b");
    expect(run("ifs(false, 1, true, 2, 3)")).toBe(2);
    expect(run("ifs(false, 1, false, 2, 3)")).toBe(3);
    expect(run("ifs(false, 1)")).toBeNull();
    expect(run('false && ("a" - 1)')).toBe(false);
    expect(run('true || ("a" - 1)')).toBe(true);
    expect(run('and(false, "a" - 1)')).toBe(false);
    expect(run('or(true, "a" - 1)')).toBe(true);
    expect(run("not(0)")).toBe(true);
    expect(run('empty("")')).toBe(true);
    expect(run("empty([])")).toBe(true);
    expect(run('empty(prop("Missing"))')).toBe(true);
    expect(run("empty(0)")).toBe(false);
    expect(run('empty("x")')).toBe(false);
  });

  test("compares lists and dates by content", () => {
    expect(run("[1, [2]] == [1, [2]]")).toBe(true);
    expect(run("[1] == [2]")).toBe(false);
    expect(run('1 == "1"')).toBe(false);
    expect(run('prop("A") == prop("B")', { A: new Date(5), B: new Date(5) })).toBe(true);
    expect(run('prop("A") < prop("B")', { A: new Date(5), B: new Date(6) })).toBe(true);
    expect(run('"a" < "b"')).toBe(true);
  });

  test("covers text functions", () => {
    expect(run('length("abc")')).toBe(3);
    expect(run("length([1, 2])")).toBe(2);
    expect(run('contains("Hello", "ell")')).toBe(true);
    expect(run('contains("Hello", "ELL")')).toBe(false);
    expect(run('contains(["a", "b"], "b")')).toBe(true);
    expect(run('test("abc123", "[0-9]+$")')).toBe(true);
    expect(run('test("abc", "^b")')).toBe(false);
    expect(run('replace("a.a", ".", "$&")')).toBe("a$&a");
    expect(run('replace("aaa", "a", "b")')).toBe("baa");
    expect(run('replaceAll("a.a.a", ".", "-")')).toBe("a-a-a");
    expect(run('lower("AB") + upper("cd")')).toBe("abCD");
    expect(run('trim("  x ")')).toBe("x");
    expect(run('substring("hello", 1, 3)')).toBe("el");
    expect(run('substring("hello", 3)')).toBe("lo");
    expect(run('concat("a", 1, true)')).toBe("a1true");
    expect(run('concat("a", prop("Missing"), "b")')).toBe("ab");
    expect(run('concat([1], [2, 3])')).toEqual([1, 2, 3]);
    expect(run('join(["a", "b"], "-")')).toBe("a-b");
    expect(run('["a", 1].join()')).toBe("a, 1");
    expect(run('split("a,b", ",")')).toEqual(["a", "b"]);
    expect(run("format(12.5)")).toBe("12.5");
    expect(run("format([1, true])")).toBe("1, true");
    expect(run('format(prop("Missing"))')).toBe("");
    expect(run('toNumber("12.5")')).toBe(12.5);
    expect(run('toNumber("abc")')).toBeNull();
    expect(run('toNumber("")')).toBeNull();
    expect(run("toNumber(true)")).toBe(1);
    expect(run('toNumber(fromTimestamp(9))')).toBe(9);
  });

  test("guards regular expressions", () => {
    expectFormulaError(() => run('test("a", "(")'), /not a valid pattern/);
    expectFormulaError(() => run(`test("a", "${"a".repeat(201)}")`), /at most 200/);
    expect(run(`test("a", "${"a?".repeat(100)}")`)).toBe(true);
    for (const pattern of ["(a+)+$", "(a*)*", "(a|a)+", "((ab)+)*", "(a+){2,}", "(.)\\\\1"]) {
      expectFormulaError(() => run(`test("aaaa", "${pattern}")`), /too long to run/);
    }
    expect(run('test("abab", "^(ab)+$")')).toBe(true);
    expect(run('test("a+", "[(+]+$")')).toBe(true);
    expectFormulaError(() => run('test(prop("Long"), "a")', { Long: "a".repeat(10001) }), /at most 10000/);
  });

  test("covers numeric functions", () => {
    expect(run("add(1, 2)")).toBe(3);
    expect(run('add("a", 1)')).toBe("a1");
    expect(run("subtract(5, 2)")).toBe(3);
    expect(run("multiply(2, 4)")).toBe(8);
    expect(run("divide(9, 3)")).toBe(3);
    expect(run("mod(7, 4)")).toBe(3);
    expect(run("pow(2, 10)")).toBe(1024);
    expect(run("round(2.5)")).toBe(3);
    expect(run("round(1.005, 2)")).toBe(1.01);
    expect(run("round(1234, -2)")).toBe(1200);
    expect(run("round(0.0000001, 2)")).toBe(0);
    expect(run("floor(-1.5)")).toBe(-2);
    expect(run("ceil(1.2)")).toBe(2);
    expect(run("abs(-3)")).toBe(3);
    expect(run("sqrt(16)")).toBe(4);
    expect(run("min(3, [1, 2])")).toBe(1);
    expect(run("max(3, [1, 5])")).toBe(5);
    expect(run("sum(1, [2, [3]])")).toBe(6);
    expect(run("sum([])")).toBe(0);
    expect(run('sum(1, prop("Missing"))')).toBe(1);
    expect(run("mean(2, 4)")).toBe(3);
    expect(run("mean([])")).toBeNull();
    expect(run("median(3, 1, 2)")).toBe(2);
    expect(run("median(4, 1, 2, 3)")).toBe(2.5);
    expect(run("min([])")).toBeNull();
    expect(Object.is(run("-1 * 0"), 0)).toBe(true);
  });

  test("covers list helpers", () => {
    expect(run("first([1, 2])")).toBe(1);
    expect(run("first([])")).toBeNull();
    expect(run("last([1, 2])")).toBe(2);
    expect(run("at([1, 2, 3], 1)")).toBe(2);
    expect(run("at([1, 2, 3], -1)")).toBe(3);
    expect(run("at([1], 5)")).toBeNull();
    expect(run("slice([1, 2, 3], 1)")).toEqual([2, 3]);
    expect(run("slice([1, 2, 3], 0, 2)")).toEqual([1, 2]);
    expect(run('slice("hello", 1, 3)')).toBe("el");
    expect(run("sort([10, 9, 1])")).toEqual([1, 9, 10]);
    expect(run('sort(["b10", "b9", "a"])')).toEqual(["a", "b9", "b10"]);
    expect(run("reverse([1, 2])")).toEqual([2, 1]);
    expect(run('unique([1, "1", 1, [1], [1]])')).toEqual([1, "1", [1]]);
    expect(run("includes([1, [2]], [2])")).toBe(true);
    expect(run("includes([1], 2)")).toBe(false);
    const source = [3, 1];
    expect(run('sort(prop("List"))', { List: source })).toEqual([1, 3]);
    expect(run('reverse(prop("List"))', { List: source })).toEqual([1, 3]);
    expect(source).toEqual([3, 1]);
  });

  test("stops past the step limit", () => {
    const chain = Array(100001).fill("1").join("+");
    expectFormulaError(() => run(chain), /too many steps/);
    expectFormulaError(() => run('sum(prop("Big"))', { Big: Array(100001).fill(1) }), /too many steps/);
    expect(run(Array(40000).fill("1").join("+"))).toBe(40000);
  });

  test("caps text growth", () => {
    const big = "a".repeat(1_000_000);
    expectFormulaError(() => run('prop("Big") + "a"', { Big: big }), /too long/);
    expectFormulaError(() => run('replaceAll("aa", "a", prop("Big"))', { Big: big }), /too long/);
  });
});

describe("formula dates", () => {
  const at = (...parts) => new Date(...parts);
  const dates = (properties) => (expression) => run(expression, properties);

  test("adds every unit across month ends", () => {
    const calc = dates({
      Jan31: at(2026, 0, 31, 10, 15),
      Leap: at(2024, 1, 29),
      Nov30: at(2026, 10, 30),
      Dec31: at(2026, 11, 31, 23, 59, 59),
    });
    expect(calc('dateAdd(prop("Jan31"), 1, "month")')).toEqual(at(2026, 1, 28, 10, 15));
    expect(calc('dateAdd(prop("Jan31"), 2, "months")')).toEqual(at(2026, 2, 31, 10, 15));
    expect(calc('dateAdd(prop("Jan31"), 1, "Months")')).toEqual(at(2026, 1, 28, 10, 15));
    expect(calc('dateAdd(prop("Leap"), 1, "year")')).toEqual(at(2025, 1, 28));
    expect(calc('dateAdd(prop("Leap"), 4, "years")')).toEqual(at(2028, 1, 29));
    expect(calc('dateAdd(prop("Nov30"), 1, "quarter")')).toEqual(at(2027, 1, 28));
    expect(calc('dateAdd(prop("Nov30"), 2, "quarters")')).toEqual(at(2027, 4, 30));
    expect(calc('dateAdd(prop("Jan31"), 1, "week")')).toEqual(at(2026, 1, 7, 10, 15));
    expect(calc('dateAdd(prop("Jan31"), 2, "weeks")')).toEqual(at(2026, 1, 14, 10, 15));
    expect(calc('dateAdd(prop("Jan31"), 1, "day")')).toEqual(at(2026, 1, 1, 10, 15));
    expect(calc('dateAdd(prop("Jan31"), 29, "days")')).toEqual(at(2026, 2, 1, 10, 15));
    expect(calc('dateAdd(prop("Dec31"), 1, "hour")')).toEqual(at(2027, 0, 1, 0, 59, 59));
    expect(calc('dateAdd(prop("Dec31"), 2, "hours")')).toEqual(at(2027, 0, 1, 1, 59, 59));
    expect(calc('dateAdd(prop("Dec31"), 1, "minute")')).toEqual(at(2027, 0, 1, 0, 0, 59));
    expect(calc('dateAdd(prop("Dec31"), 2, "minutes")')).toEqual(at(2027, 0, 1, 0, 1, 59));
    expect(calc('dateAdd(prop("Dec31"), 1, "second")')).toEqual(at(2027, 0, 1, 0, 0, 0));
    expect(calc('dateAdd(prop("Dec31"), 2, "seconds")')).toEqual(at(2027, 0, 1, 0, 0, 1));
  });

  test("subtracts every unit across month ends", () => {
    const calc = dates({ Mar31: at(2026, 2, 31, 8), Mar1: at(2026, 2, 1) });
    expect(calc('dateSubtract(prop("Mar31"), 1, "month")')).toEqual(at(2026, 1, 28, 8));
    expect(calc('dateSubtract(prop("Mar31"), 1, "quarter")')).toEqual(at(2025, 11, 31, 8));
    expect(calc('dateSubtract(prop("Mar31"), 1, "year")')).toEqual(at(2025, 2, 31, 8));
    expect(calc('dateSubtract(prop("Mar1"), 1, "week")')).toEqual(at(2026, 1, 22));
    expect(calc('dateSubtract(prop("Mar1"), 1, "day")')).toEqual(at(2026, 1, 28));
    expect(calc('dateSubtract(prop("Mar1"), 1, "hour")')).toEqual(at(2026, 1, 28, 23));
    expect(calc('dateSubtract(prop("Mar1"), 1, "minute")')).toEqual(at(2026, 1, 28, 23, 59));
    expect(calc('dateSubtract(prop("Mar1"), 1, "second")')).toEqual(at(2026, 1, 28, 23, 59, 59));
  });

  test("measures whole units between dates", () => {
    const calc = dates({
      Jan31: at(2026, 0, 31),
      Feb28: at(2026, 1, 28),
      Mar30: at(2026, 2, 30),
      Start: at(2024, 1, 29, 12),
      End: at(2026, 1, 28, 12),
      Late: at(2026, 0, 1, 23),
      Next: at(2026, 0, 2, 1),
    });
    expect(calc('dateBetween(prop("Feb28"), prop("Jan31"), "months")')).toBe(1);
    expect(calc('dateBetween(prop("Jan31"), prop("Feb28"), "months")')).toBe(-1);
    expect(calc('dateBetween(prop("Mar30"), prop("Jan31"), "months")')).toBe(1);
    expect(calc('dateBetween(prop("End"), prop("Start"), "years")')).toBe(2);
    expect(calc('dateBetween(prop("End"), prop("Start"), "quarters")')).toBe(8);
    expect(calc('dateBetween(prop("Feb28"), prop("Jan31"), "weeks")')).toBe(4);
    expect(calc('dateBetween(prop("Feb28"), prop("Jan31"), "days")')).toBe(28);
    expect(calc('dateBetween(prop("Next"), prop("Late"), "days")')).toBe(0);
    expect(calc('dateBetween(prop("Next"), prop("Late"), "hours")')).toBe(2);
    expect(calc('dateBetween(prop("Next"), prop("Late"), "minutes")')).toBe(120);
    expect(calc('dateBetween(prop("Next"), prop("Late"), "seconds")')).toBe(7200);
    expect(calc('dateBetween(prop("Late"), prop("Next"), "seconds")')).toBe(-7200);
    expect(Object.is(calc('dateBetween(prop("Late"), prop("Next"), "days")'), 0)).toBe(true);
    expectFormulaError(() => calc('dateBetween(prop("Late"), prop("Next"), "fortnights")'), /not a date unit/);
  });

  test("finds the start and end of each unit", () => {
    const calc = dates({ When: at(2026, 4, 13, 15, 45, 30, 500) });
    expect(calc('dateStart(prop("When"))')).toEqual(at(2026, 4, 13));
    expect(calc('dateEnd(prop("When"))')).toEqual(at(2026, 4, 13, 23, 59, 59, 999));
    expect(calc('dateStart(prop("When"), "year")')).toEqual(at(2026, 0, 1));
    expect(calc('dateEnd(prop("When"), "year")')).toEqual(at(2026, 11, 31, 23, 59, 59, 999));
    expect(calc('dateStart(prop("When"), "quarter")')).toEqual(at(2026, 3, 1));
    expect(calc('dateEnd(prop("When"), "quarter")')).toEqual(at(2026, 5, 30, 23, 59, 59, 999));
    expect(calc('dateStart(prop("When"), "month")')).toEqual(at(2026, 4, 1));
    expect(calc('dateEnd(prop("When"), "month")')).toEqual(at(2026, 4, 31, 23, 59, 59, 999));
    expect(calc('dateStart(prop("When"), "week")')).toEqual(at(2026, 4, 11));
    expect(calc('dateEnd(prop("When"), "week")')).toEqual(at(2026, 4, 17, 23, 59, 59, 999));
    expect(calc('dateStart(prop("When"), "hour")')).toEqual(at(2026, 4, 13, 15));
    expect(calc('dateStart(prop("When"), "minute")')).toEqual(at(2026, 4, 13, 15, 45));
    expect(calc('dateStart(prop("When"), "second")')).toEqual(at(2026, 4, 13, 15, 45, 30));
  });

  test("formats every pattern token", () => {
    const calc = dates({ Morning: at(2026, 2, 5, 9, 7, 3), Evening: at(2026, 11, 25, 18, 30, 0) });
    expect(calc('formatDate(prop("Morning"), "YYYY YY MMMM MMM MM M DD D dddd ddd HH mm ss A")'))
      .toBe("2026 26 March Mar 03 3 05 5 Thursday Thu 09 07 03 AM");
    expect(calc('formatDate(prop("Evening"), "MMM D, YYYY HH:mm A")')).toBe("Dec 25, 2026 18:30 PM");
    expect(calc('formatDate(prop("Morning"), "[Day] D")')).toBe("Day 5");
  });

  test("reads date parts", () => {
    const calc = dates({ Sunday: at(2026, 2, 15, 14, 30), Monday: at(2026, 2, 16) });
    expect(calc('year(prop("Sunday"))')).toBe(2026);
    expect(calc('month(prop("Sunday"))')).toBe(3);
    expect(calc('date(prop("Sunday"))')).toBe(15);
    expect(calc('day(prop("Sunday"))')).toBe(7);
    expect(calc('day(prop("Monday"))')).toBe(1);
    expect(calc('hour(prop("Sunday"))')).toBe(14);
    expect(calc('minute(prop("Sunday"))')).toBe(30);
  });

  test("uses the context clock and timestamps", () => {
    expect(run("now()")).toEqual(NOW);
    expect(run("today()")).toEqual(at(2026, 2, 15));
    expect(run("timestamp(fromTimestamp(1234))")).toBe(1234);
    expect(run('year("2026-03-05")')).toBe(2026);
    expect(run("fromTimestamp(1e30)")).toBeNull();
  });
});

describe("computeRowValues", () => {
  test("returns a cell for every stored property type", () => {
    const schema = schemaOf(
      { id: "text", name: "Text", type: "text" },
      { id: "plain", name: "Plain", type: "number" },
      { id: "percent", name: "Percent", type: "number", numberFormat: "percent" },
      { id: "dollar", name: "Dollar", type: "number", numberFormat: "dollar" },
      { id: "euro", name: "Euro", type: "number", numberFormat: "euro" },
      { id: "pound", name: "Pound", type: "number", numberFormat: "pound" },
      { id: "yen", name: "Yen", type: "number", numberFormat: "yen" },
      { id: "status", name: "Status", type: "status", options: statusOptions },
      { id: "select", name: "Select", type: "select", options: tagOptions },
      { id: "tags", name: "Tags", type: "multi_select", options: tagOptions },
      { id: "done", name: "Done", type: "checkbox" },
      { id: "url", name: "Url", type: "url" },
      { id: "person", name: "Person", type: "person" },
      { id: "created", name: "Created", type: "created_time" },
      { id: "edited", name: "Edited", type: "last_edited_time" },
    );
    const cells = compute(schema, [row("r1", null, {
      text: "hello",
      plain: 1234567.5,
      percent: 50,
      dollar: 12.5,
      euro: -3,
      pound: 1000,
      yen: 500,
      status: "s_doing",
      select: "t_blue",
      tags: ["t_red", "t_gone", "t_green"],
      done: true,
      url: "https://x.test",
      person: ["u1", "u2"],
    })]).get("r1");
    expect(cells.title).toEqual({ value: "", display: "" });
    expect(cells.text).toEqual({ value: "hello", display: "hello" });
    expect(cells.plain).toEqual({ value: 1234567.5, display: "1234567.5" });
    expect(cells.percent.display).toBe("50%");
    expect(cells.dollar.display).toBe("$12.50");
    expect(cells.euro.display).toBe("-€3");
    expect(cells.pound.display).toBe("£1000");
    expect(cells.yen.display).toBe("¥500");
    expect(cells.status).toEqual({ value: "Doing", display: "Doing" });
    expect(cells.select).toEqual({ value: "Blue", display: "Blue" });
    expect(cells.tags).toEqual({ value: ["Red", "Green"], display: "Red, Green" });
    expect(cells.done).toEqual({ value: true, display: "true" });
    expect(cells.url.value).toBe("https://x.test");
    expect(cells.person).toEqual({ value: ["u1", "u2"], display: "u1, u2" });
    expect(cells.created.value).toEqual(new Date("2026-01-02T03:04:05.000Z"));
    expect(cells.edited.value).toEqual(new Date("2026-01-03T03:04:05.000Z"));
  });

  test("fills unset values with empty cells", () => {
    const schema = schemaOf(
      { id: "text", name: "Text", type: "text" },
      { id: "number", name: "Number", type: "number" },
      { id: "status", name: "Status", type: "status", options: statusOptions },
      { id: "tags", name: "Tags", type: "multi_select", options: tagOptions },
      { id: "when", name: "When", type: "date" },
      { id: "done", name: "Done", type: "checkbox" },
    );
    const cells = compute(schema, [row("r1", "One")]).get("r1");
    expect(cells.text).toEqual({ value: null, display: "" });
    expect(cells.number).toEqual({ value: null, display: "" });
    expect(cells.status).toEqual({ value: null, display: "" });
    expect(cells.tags).toEqual({ value: [], display: "" });
    expect(cells.when).toEqual({ value: null, display: "" });
    expect(cells.done).toEqual({ value: false, display: "false" });
  });

  describe("under a non-UTC time zone", () => {
    const original = process.env.TZ;

    beforeAll(() => {
      process.env.TZ = "America/Los_Angeles";
    });
    afterAll(() => {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    });

    test("treats date-only strings as local dates", () => {
      expect(new Date(2026, 2, 5).getTimezoneOffset()).toBeGreaterThan(0);
      const schema = schemaOf({ id: "when", name: "When", type: "date" });
      const rows = [row("r1", "One", { when: { start: "2026-03-05", end: "2026-03-07" } })];
      const cell = compute(schema, rows).get("r1").when;
      expect(cell.value).toEqual(new Date(2026, 2, 5));
      expect(cell.value.getDate()).toBe(5);
      expect(cell.display).toBe("2026-03-05 → 2026-03-07");
      expect(run('formatDate("2026-03-05", "YYYY-MM-DD")')).toBe("2026-03-05");
    });

    test("filters by calendar day without a shift", () => {
      const schema = schemaOf({ id: "when", name: "When", type: "date" });
      const rows = [row("r1", "One", { when: { start: "2026-03-05" } })];
      const cells = compute(schema, rows);
      const match = (operator, value) => applyDatabaseView({
        schema,
        rows,
        cells,
        config: { filters: [{ propertyId: "when", operator, value }] },
      }).length;
      expect(match("on_or_after", "2026-03-05")).toBe(1);
      expect(match("on_or_before", "2026-03-05")).toBe(1);
      expect(match("before", "2026-03-05")).toBe(0);
      expect(match("after", "2026-03-05")).toBe(0);
    });
  });

  test("keeps full timestamps and rejects impossible dates", () => {
    const schema = schemaOf({ id: "when", name: "When", type: "date" });
    const iso = "2026-03-05T10:20:00.000Z";
    const cells = compute(schema, [
      row("r1", "One", { when: { start: iso } }),
      row("r2", "Two", { when: { start: "2026-02-31" } }),
      row("r3", "Three", { when: { start: "soon" } }),
    ]);
    expect(cells.get("r1").when.value).toEqual(new Date(iso));
    expect(cells.get("r2").when.value).toBeNull();
    expect(cells.get("r3").when.value).toBeNull();
  });

  const relationSchema = (...extra) => schemaOf(
    { id: "items", name: "Items", type: "relation", relation: { databaseId: "db_items" } },
    ...extra,
  );
  const itemSchema = schemaOf(
    { id: "price", name: "Price", type: "number", numberFormat: "dollar" },
    { id: "qty", name: "Qty", type: "number" },
    { id: "paid", name: "Paid", type: "checkbox" },
    { id: "due", name: "Due", type: "date" },
    { id: "tags", name: "Tags", type: "multi_select", options: tagOptions },
    { id: "total", name: "Total", type: "formula", formula: { expression: 'prop("Price") * prop("Qty")' } },
  );
  const itemRows = [
    row("i1", "Apple", { price: 2, qty: 3, paid: true, due: { start: "2026-05-01" }, tags: ["t_red", "t_blue"] }),
    row("i2", "Pear", { price: 4.5, qty: 2, paid: false, due: { start: "2026-04-01" }, tags: ["t_green"] }),
    row("i3", null, { paid: true }),
  ];
  const relatedItems = { db_items: { schema: itemSchema, rows: itemRows } };
  const rollupOf = (targetPropertyId, rollup, extra = {}) => ({
    id: "r",
    name: "R",
    type: "rollup",
    rollup: { relationPropertyId: "items", targetPropertyId, function: rollup },
    ...extra,
  });
  const rollupCell = (targetPropertyId, rollup, related = ["i1", "i2", "i3"], extra = {}) =>
    compute(relationSchema(rollupOf(targetPropertyId, rollup, extra)), [row("p", "Parent", { items: related })], relatedItems)
      .get("p").r;

  test("resolves relations to titles and skips missing rows", () => {
    const cell = compute(relationSchema(), [row("p", "P", { items: ["i2", "gone", "i1", "i3"] })], relatedItems).get("p").items;
    expect(cell.value).toEqual(["Pear", "Apple", ""]);
  });

  test("applies each rollup function", () => {
    expect(rollupCell("title", "show_original", ["i1", "i2"])).toEqual({ value: ["Apple", "Pear"], display: "Apple, Pear" });
    expect(rollupCell("tags", "show_original").value).toEqual(["Red", "Blue", "Green"]);
    expect(rollupCell("price", "count").value).toBe(3);
    expect(rollupCell("price", "count_values").value).toBe(2);
    expect(rollupCell("price", "sum")).toEqual({ value: 6.5, display: "$6.50" });
    expect(rollupCell("price", "average").value).toBe(3.25);
    expect(rollupCell("price", "min").value).toBe(2);
    expect(rollupCell("price", "max").value).toBe(4.5);
    expect(rollupCell("paid", "percent_checked").value).toBeCloseTo(66.6667, 3);
    expect(rollupCell("paid", "percent_checked").display).toBe("66.67%");
    expect(rollupCell("due", "earliest").value).toEqual(new Date(2026, 3, 1));
    expect(rollupCell("due", "latest").value).toEqual(new Date(2026, 4, 1));
  });

  test("handles rollups with no related rows", () => {
    expect(rollupCell("price", "count", []).value).toBe(0);
    expect(rollupCell("price", "sum", []).value).toBe(0);
    expect(rollupCell("price", "average", []).value).toBeNull();
    expect(rollupCell("price", "min", []).value).toBeNull();
    expect(rollupCell("paid", "percent_checked", []).value).toBe(0);
    expect(rollupCell("due", "earliest", []).value).toBeNull();
    expect(rollupCell("title", "show_original", [])).toEqual({ value: [], display: "" });
  });

  test("rolls up a formula on the related rows", () => {
    expect(rollupCell("total", "sum", ["i1", "i2"]).value).toBe(15);
    expect(rollupCell("total", "show_original", ["i1", "i2"]).value).toEqual([6, 9]);
  });

  test("reports a rollup whose configuration is stale", () => {
    expect(rollupCell("gone", "sum").error).toMatch(/no longer exists/);
    const schema = schemaOf({ ...rollupOf("price", "sum"), rollup: { relationPropertyId: "gone", targetPropertyId: "price", function: "sum" } });
    expect(compute(schema, [row("p", "P")]).get("p").r.error).toMatch(/no longer exists/);
  });

  test("feeds a rollup into a formula", () => {
    const schema = relationSchema(
      rollupOf("total", "sum"),
      { id: "f", name: "F", type: "formula", formula: { expression: 'prop("R") + 1' } },
    );
    expect(compute(schema, [row("p", "P", { items: ["i1", "i2"] })], relatedItems).get("p").f.value).toBe(16);
  });

  test("uses the current database for a self-relation", () => {
    const schema = schemaOf(
      { id: "kids", name: "Kids", type: "relation", relation: { databaseId: "db_self" } },
      { id: "points", name: "Points", type: "number" },
      { id: "kidTotal", name: "Kid total", type: "rollup", rollup: { relationPropertyId: "kids", targetPropertyId: "points", function: "sum" } },
      { id: "tree", name: "Tree", type: "rollup", rollup: { relationPropertyId: "kids", targetPropertyId: "whole", function: "sum" } },
      { id: "whole", name: "Whole", type: "formula", formula: { expression: 'prop("Points") + prop("Tree")' } },
    );
    const cells = compute(schema, [
      row("a", "A", { kids: ["b", "c"], points: 1 }),
      row("b", "B", { kids: ["d"], points: 2 }),
      row("c", "C", { points: 3 }),
      row("d", "D", { points: 4 }),
    ]);
    expect(cells.get("a").kids.value).toEqual(["B", "C"]);
    expect(cells.get("a").kidTotal.value).toBe(5);
    expect(cells.get("a").whole.value).toBe(10);
    expect(cells.get("b").whole.value).toBe(6);
  });

  test("detects cycles between formulas", () => {
    const schema = schemaOf(
      { id: "a", name: "A", type: "formula", formula: { expression: 'prop("B") + 1' } },
      { id: "b", name: "B", type: "formula", formula: { expression: 'prop("A") + 1' } },
      { id: "self", name: "Self", type: "formula", formula: { expression: 'prop("Self")' } },
      { id: "after", name: "After", type: "formula", formula: { expression: 'prop("A")' } },
      { id: "fine", name: "Fine", type: "formula", formula: { expression: '1 + 1' } },
    );
    const cells = compute(schema, [row("r", "R")]).get("r");
    for (const id of ["a", "b", "self", "after"]) {
      expect(cells[id]).toEqual({ value: null, display: "", error: "Circular reference" });
    }
    expect(cells.fine.value).toBe(2);
  });

  test("detects cycles through rollups on a self-relation", () => {
    const schema = schemaOf(
      { id: "link", name: "Link", type: "relation", relation: { databaseId: "db_self" } },
      { id: "up", name: "Up", type: "rollup", rollup: { relationPropertyId: "link", targetPropertyId: "calc", function: "sum" } },
      { id: "calc", name: "Calc", type: "formula", formula: { expression: 'prop("Up") + 1' } },
    );
    const cells = compute(schema, [row("a", "A", { link: ["b"] }), row("b", "B", { link: ["a"] }), row("c", "C")]);
    expect(cells.get("a").up.error).toBe("Circular reference");
    expect(cells.get("b").calc.error).toBe("Circular reference");
    expect(cells.get("c").calc.value).toBe(1);
  });

  test("detects cycles across two databases", () => {
    const mine = schemaOf(
      { id: "other", name: "Other", type: "relation", relation: { databaseId: "db_other" } },
      { id: "up", name: "Up", type: "rollup", rollup: { relationPropertyId: "other", targetPropertyId: "back", function: "sum" } },
    );
    const theirs = schemaOf(
      { id: "mine", name: "Mine", type: "relation", relation: { databaseId: "db_mine" } },
      { id: "back", name: "Back", type: "rollup", rollup: { relationPropertyId: "mine", targetPropertyId: "up", function: "sum" } },
    );
    const cells = compute(mine, [row("a", "A", { other: ["x"] })], {
      db_other: { schema: theirs, rows: [row("x", "X", { mine: ["a"] })] },
    });
    expect(cells.get("a").up.error).toBe("Circular reference");
  });

  test("survives a very long non-circular reference chain", () => {
    const schema = schemaOf(
      { id: "next", name: "Next", type: "relation", relation: { databaseId: "db_self" } },
      { id: "up", name: "Up", type: "rollup", rollup: { relationPropertyId: "next", targetPropertyId: "calc", function: "sum" } },
      { id: "calc", name: "Calc", type: "formula", formula: { expression: 'prop("Up") + 1' } },
    );
    const rows = Array.from({ length: 5000 }, (_, index) => row(`r${index}`, "R", { next: index < 4999 ? [`r${index + 1}`] : [] }));
    const cells = compute(schema, rows);
    expect(cells.size).toBe(5000);
    expect(cells.get("r4999").calc.value).toBe(1);
    expect(typeof cells.get("r0").calc.error).toBe("string");
  });

  test("keeps formula errors on the cell", () => {
    const schema = schemaOf(
      { id: "bad", name: "Bad", type: "formula", formula: { expression: "1 +" } },
      { id: "type", name: "Type", type: "formula", formula: { expression: '"a" - 1' } },
      { id: "unknown", name: "Unknown", type: "formula", formula: { expression: 'prop("Nope")' } },
      { id: "blank", name: "Blank", type: "formula", formula: { expression: "  " } },
      { id: "nothing", name: "Nothing", type: "formula" },
      { id: "ok", name: "Ok", type: "formula", formula: { expression: '"x"' } },
    );
    const cells = compute(schema, [row("r", "R")]).get("r");
    expect(cells.bad.value).toBeNull();
    expect(cells.bad.display).toBe("");
    expect(cells.bad.error).toMatch(/end of the formula/);
    expect(cells.type.error).toMatch(/Cannot use -/);
    expect(cells.unknown.error).toMatch(/no property named "Nope"/);
    expect(cells.blank).toEqual({ value: null, display: "" });
    expect(cells.nothing).toEqual({ value: null, display: "" });
    expect(cells.ok.value).toBe("x");
  });

  test("resolves prop by name to the computed value", () => {
    const schema = schemaOf(
      { id: "s", name: "Stage", type: "select", options: tagOptions },
      { id: "when", name: "When", type: "date" },
      { id: "n", name: "Amount", type: "number", numberFormat: "dollar" },
      { id: "f1", name: "F1", type: "formula", formula: { expression: 'prop("Stage") + "!"' } },
      { id: "f2", name: "F2", type: "formula", formula: { expression: 'formatDate(prop("When"), "D/M")' } },
      { id: "f3", name: "F3", type: "formula", numberFormat: "dollar", formula: { expression: 'prop("Amount") * 2' } },
      { id: "f4", name: "F4", type: "formula", formula: { expression: 'prop("Name").upper()' } },
    );
    const cells = compute(schema, [row("r", "row", { s: "t_red", when: { start: "2026-03-05" }, n: 5 })]).get("r");
    expect(cells.f1.value).toBe("Red!");
    expect(cells.f2.value).toBe("5/3");
    expect(cells.f3).toEqual({ value: 10, display: "$10" });
    expect(cells.f4.value).toBe("ROW");
  });

  test("parses each expression once per call", () => {
    const schema = schemaOf({ id: "f", name: "F", type: "formula", formula: { expression: '"x"' } });
    const originalTest = RegExp.prototype.test;
    const tokenChecksFor = (rowCount) => {
      let tokenChecks = 0;
      RegExp.prototype.test = function counted(value) {
        if (this.source === "\\s") tokenChecks += 1;
        return originalTest.call(this, value);
      };
      try {
        compute(schema, Array.from({ length: rowCount }, (_, index) => row(`r${index}`, "R")));
      } finally {
        RegExp.prototype.test = originalTest;
      }
      return tokenChecks;
    };
    expect(tokenChecksFor(1)).toBeGreaterThan(0);
    expect(tokenChecksFor(50)).toBe(tokenChecksFor(1));
  });

  test("does not mistake a property id for an object key", () => {
    const schema = schemaOf({ id: "__proto__", name: "Odd", type: "text" });
    const cells = compute(schema, [row("r", "R", JSON.parse('{"__proto__":"hi"}'))]).get("r");
    expect(Object.hasOwn(cells, "__proto__")).toBe(true);
    expect(cells.title.value).toBe("R");
  });
});

describe("applyDatabaseView", () => {
  const schema = schemaOf(
    { id: "text", name: "Text", type: "text" },
    { id: "n", name: "N", type: "number" },
    { id: "status", name: "Status", type: "status", options: statusOptions },
    { id: "tags", name: "Tags", type: "multi_select", options: tagOptions },
    { id: "when", name: "When", type: "date" },
    { id: "done", name: "Done", type: "checkbox" },
    { id: "flag", name: "Flag", type: "formula", formula: { expression: 'prop("N") > 100' } },
  );
  const rows = [
    row("a", "Alpha", { text: "Hello World", n: 5, status: "s_done", tags: ["t_red", "t_blue"], when: { start: "2026-03-10" }, done: true }),
    row("b", "Beta", { text: "goodbye", n: 10, status: "s_todo", tags: ["t_blue"], when: { start: "2026-03-05T23:30:00" }, done: false }),
    row("c", "Gamma", { text: "", n: 2, status: "s_doing", tags: [], when: { start: "2026-03-01" }, done: false }),
    row("d", "Delta", {}),
  ];
  const cells = compute(schema, rows);
  const ids = (config, input = rows) => applyDatabaseView({ schema, rows: input, cells, config }).map((item) => item.id);
  const filtered = (propertyId, operator, value) => ids({ filters: [{ propertyId, operator, value }] });

  test("preserves the input order and copies the list with no sorts or filters", () => {
    const result = applyDatabaseView({ schema, rows, cells, config: {} });
    expect(result.map((item) => item.id)).toEqual(["a", "b", "c", "d"]);
    expect(result).not.toBe(rows);
  });

  test("matches text with contains and not_contains", () => {
    expect(filtered("text", "contains", "WORLD")).toEqual(["a"]);
    expect(filtered("text", "not_contains", "world")).toEqual(["b", "c", "d"]);
    expect(filtered("tags", "contains", "blue")).toEqual(["a", "b"]);
    expect(filtered("tags", "contains", "blu")).toEqual([]);
    expect(filtered("tags", "not_contains", "RED")).toEqual(["b", "c", "d"]);
  });

  test("matches by display with is and is_not", () => {
    expect(filtered("text", "is", "hello world")).toEqual(["a"]);
    expect(filtered("text", "is_not", "hello world")).toEqual(["b", "c", "d"]);
    expect(filtered("status", "is", "todo")).toEqual(["b"]);
    expect(filtered("tags", "is", "Red")).toEqual(["a"]);
    expect(filtered("tags", "is_not", "Red")).toEqual(["b", "c", "d"]);
    expect(filtered("n", "is", 5)).toEqual(["a"]);
    expect(filtered("done", "is", true)).toEqual(["a"]);
    expect(filtered("when", "is", "2026-03-10")).toEqual(["a"]);
  });

  test("matches prefixes and suffixes", () => {
    expect(filtered("text", "starts_with", "HELLO")).toEqual(["a"]);
    expect(filtered("text", "ends_with", "BYE")).toEqual(["b"]);
    expect(filtered("tags", "starts_with", "gr")).toEqual([]);
    expect(filtered("tags", "ends_with", "ed")).toEqual(["a"]);
  });

  test("recognises empty values", () => {
    expect(filtered("text", "is_empty")).toEqual(["c", "d"]);
    expect(filtered("text", "is_not_empty")).toEqual(["a", "b"]);
    expect(filtered("tags", "is_empty")).toEqual(["c", "d"]);
    expect(filtered("n", "is_empty")).toEqual(["d"]);
    expect(filtered("flag", "is_empty")).toEqual(["a", "b", "c", "d"]);
    expect(filtered("done", "is_empty")).toEqual([]);
    expect(filtered("done", "is_not_empty")).toEqual(["a", "b", "c", "d"]);
  });

  test("compares numbers", () => {
    expect(filtered("n", "gt", 5)).toEqual(["b"]);
    expect(filtered("n", "gte", 5)).toEqual(["a", "b"]);
    expect(filtered("n", "lt", 5)).toEqual(["c"]);
    expect(filtered("n", "lte", "5")).toEqual(["a", "c"]);
  });

  test("compares calendar days", () => {
    expect(filtered("when", "before", "2026-03-05")).toEqual(["c"]);
    expect(filtered("when", "after", "2026-03-05")).toEqual(["a"]);
    expect(filtered("when", "on_or_before", "2026-03-05")).toEqual(["b", "c"]);
    expect(filtered("when", "on_or_after", "2026-03-05")).toEqual(["a", "b"]);
  });

  test("checks checkboxes", () => {
    expect(filtered("done", "checked")).toEqual(["a"]);
    expect(filtered("done", "unchecked")).toEqual(["b", "c", "d"]);
  });

  test("combines filters with and by default and or on request", () => {
    const filters = [
      { propertyId: "n", operator: "gte", value: 5 },
      { propertyId: "done", operator: "checked" },
    ];
    expect(ids({ filters })).toEqual(["a"]);
    expect(ids({ filters, filterMode: "and" })).toEqual(["a"]);
    expect(ids({ filters, filterMode: "or" })).toEqual(["a", "b"]);
  });

  test("ignores filters on missing properties and filters not filled in yet", () => {
    const gone = { propertyId: "gone", operator: "is", value: "x" };
    const blank = { propertyId: "text", operator: "contains", value: "" };
    const open = { propertyId: "n", operator: "gt", value: null };
    const badDate = { propertyId: "when", operator: "before", value: "soon" };
    const real = { propertyId: "done", operator: "checked" };
    for (const filterMode of ["and", "or"]) {
      expect(ids({ filterMode, filters: [gone, blank, open, badDate] })).toEqual(["a", "b", "c", "d"]);
      expect(ids({ filterMode, filters: [gone, blank, real] })).toEqual(["a"]);
    }
  });

  test("keeps nulls and empties last in both directions", () => {
    expect(ids({ sorts: [{ propertyId: "n", direction: "asc" }] })).toEqual(["c", "a", "b", "d"]);
    expect(ids({ sorts: [{ propertyId: "n", direction: "desc" }] })).toEqual(["b", "a", "c", "d"]);
    expect(ids({ sorts: [{ propertyId: "text", direction: "asc" }] })).toEqual(["b", "a", "c", "d"]);
    expect(ids({ sorts: [{ propertyId: "text", direction: "desc" }] })).toEqual(["a", "b", "c", "d"]);
    expect(ids({ sorts: [{ propertyId: "tags", direction: "desc" }] })).toEqual(["a", "b", "c", "d"]);
  });

  test("sorts select and status by option order", () => {
    expect(ids({ sorts: [{ propertyId: "status", direction: "asc" }] })).toEqual(["b", "c", "a", "d"]);
    expect(ids({ sorts: [{ propertyId: "status", direction: "desc" }] })).toEqual(["a", "c", "b", "d"]);
  });

  test("sorts dates chronologically and strings naturally", () => {
    expect(ids({ sorts: [{ propertyId: "when", direction: "asc" }] })).toEqual(["c", "b", "a", "d"]);
    const titled = [row("x", "Item 10"), row("y", "item 9"), row("z", "Item 100")];
    const titleCells = compute(schema, titled);
    const order = applyDatabaseView({ schema, rows: titled, cells: titleCells, config: { sorts: [{ propertyId: "title", direction: "asc" }] } });
    expect(order.map((item) => item.id)).toEqual(["y", "x", "z"]);
  });

  test("applies several sorts in order and stays stable", () => {
    const sample = [
      row("1", "T", { n: 2, text: "b" }),
      row("2", "T", { n: 1, text: "b" }),
      row("3", "T", { n: 2, text: "a" }),
      row("4", "T", { n: 1, text: "a" }),
      row("5", "T", { n: 2, text: "a" }),
    ];
    const sampleCells = compute(schema, sample);
    const sorted = (sorts) => applyDatabaseView({ schema, rows: sample, cells: sampleCells, config: { sorts } }).map((item) => item.id);
    expect(sorted([{ propertyId: "n", direction: "asc" }, { propertyId: "text", direction: "desc" }])).toEqual(["2", "4", "1", "3", "5"]);
    expect(sorted([{ propertyId: "text", direction: "asc" }])).toEqual(["3", "4", "5", "1", "2"]);
    expect(sorted([{ propertyId: "text", direction: "desc" }])).toEqual(["1", "2", "3", "4", "5"]);
    expect(sorted([{ propertyId: "gone", direction: "asc" }])).toEqual(["1", "2", "3", "4", "5"]);
  });
});

describe("groupRows", () => {
  const schema = schemaOf(
    { id: "status", name: "Status", type: "status", options: statusOptions },
    { id: "tags", name: "Tags", type: "multi_select", options: tagOptions },
    { id: "done", name: "Done", type: "checkbox" },
    { id: "owner", name: "Owner", type: "text" },
  );
  const rows = [
    row("a", "A", { status: "s_done", tags: ["t_red", "t_green"], done: true, owner: "Sam" }),
    row("b", "B", { status: "s_done", tags: ["t_green"], done: false, owner: "Kim" }),
    row("c", "C", { owner: "Sam" }),
  ];
  const cells = compute(schema, rows);
  const group = (propertyId, input = rows) => groupRows({ schema, rows: input, cells, propertyId })
    .map((item) => ({ ...item, rows: item.rows.map((entry) => entry.id) }));

  test("gives each option a group in schema order and a trailing No value", () => {
    expect(group("status")).toEqual([
      { key: "s_todo", label: "Todo", color: "gray", optionId: "s_todo", rows: [] },
      { key: "s_doing", label: "Doing", color: "blue", optionId: "s_doing", rows: [] },
      { key: "s_done", label: "Done", color: "green", optionId: "s_done", rows: ["a", "b"] },
      { key: "__none", label: "No value", optionId: null, rows: ["c"] },
    ]);
  });

  test("omits No value when no row needs it", () => {
    expect(group("status", rows.slice(0, 2)).map((item) => item.key)).toEqual(["s_todo", "s_doing", "s_done"]);
  });

  test("puts a multi_select row in each of its groups", () => {
    const groups = group("tags");
    expect(groups.map((item) => item.key)).toEqual(["t_red", "t_blue", "t_green", "__none"]);
    expect(groups[0].rows).toEqual(["a"]);
    expect(groups[1].rows).toEqual([]);
    expect(groups[2].rows).toEqual(["a", "b"]);
    expect(groups[3].rows).toEqual(["c"]);
  });

  test("makes two checkbox groups", () => {
    const groups = group("done");
    expect(groups.map((item) => [item.key, item.rows])).toEqual([["checked", ["a"]], ["unchecked", ["b", "c"]]]);
    expect(groups.every((item) => item.optionId === null)).toBe(true);
    expect(group("done", []).map((item) => item.rows)).toEqual([[], []]);
  });

  test("groups other types by display in first-seen order", () => {
    expect(group("owner")).toEqual([
      { key: "Sam", label: "Sam", optionId: null, rows: ["a", "c"] },
      { key: "Kim", label: "Kim", optionId: null, rows: ["b"] },
    ]);
    const blanks = [row("x", "X"), row("y", "Y", { owner: "Sam" })];
    const blankCells = compute(schema, blanks);
    const result = groupRows({ schema, rows: blanks, cells: blankCells, propertyId: "owner" });
    expect(result.map((item) => [item.key, item.label])).toEqual([["__none", "No value"], ["Sam", "Sam"]]);
  });

  test("keeps every row visible when the property is gone", () => {
    expect(group("gone").map((item) => item.rows)).toEqual([["a", "b", "c"]]);
  });
});
