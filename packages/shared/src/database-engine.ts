import type {
  DatabaseDateValue,
  DatabaseFilter,
  DatabaseOption,
  DatabaseProperty,
  DatabasePropertyValue,
  DatabaseRow,
  DatabaseSchema,
  DatabaseViewConfig,
} from "./database";

const MAX_NESTING = 64;
const MAX_STEPS = 100_000;
const MAX_TEXT_LENGTH = 1_000_000;
const MAX_REGEX_PATTERN_LENGTH = 200;
const MAX_REGEX_INPUT_LENGTH = 10_000;
const MAX_REFERENCE_DEPTH = 128;

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export type FormulaValue = string | number | boolean | Date | FormulaValue[] | null;

export type FormulaContext = {
  getProperty(name: string): FormulaValue;
  now: Date;
};

type BinaryOperator = "+" | "-" | "*" | "/" | "%" | "^" | "==" | "!=" | ">" | "<" | ">=" | "<=" | "&&" | "||";

export type FormulaAst =
  | { type: "literal"; value: string | number | boolean; position: number }
  | { type: "list"; items: FormulaAst[]; position: number }
  | { type: "unary"; operator: "-" | "!"; operand: FormulaAst; position: number }
  | { type: "binary"; operator: BinaryOperator; left: FormulaAst; right: FormulaAst; position: number }
  | { type: "ternary"; condition: FormulaAst; consequent: FormulaAst; alternate: FormulaAst; position: number }
  | { type: "call"; name: string; args: FormulaAst[]; position: number };

export class FormulaError extends Error {
  readonly position: number | null;

  constructor(message: string, position: number | null = null) {
    super(message);
    this.name = "FormulaError";
    this.position = position;
  }
}

const syntaxError = (message: string, position: number) =>
  new FormulaError(`${message} at character ${position + 1}`, position);

type Token =
  | { kind: "number"; value: number; position: number }
  | { kind: "string"; value: string; position: number }
  | { kind: "name"; value: string; position: number }
  | { kind: "symbol"; value: string; position: number }
  | { kind: "end"; value: ""; position: number };

const SYMBOLS = ["==", "!=", ">=", "<=", "&&", "||", "+", "-", "*", "/", "%", "^", ">", "<", "!", "(", ")", "[", "]", ",", ".", "?", ":"];
const STRING_ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r" };

const isDigit = (character: string | undefined) => character !== undefined && character >= "0" && character <= "9";
const isNameStart = (character: string) => /[A-Za-z_]/.test(character);
const isNamePart = (character: string | undefined) => character !== undefined && /[A-Za-z0-9_]/.test(character);

const skipDigits = (source: string, from: number) => {
  let end = from;
  while (isDigit(source[end])) end += 1;
  return end;
};

const numberEnd = (source: string, start: number) => {
  let end = skipDigits(source, start);
  if (source[end] === "." && isDigit(source[end + 1])) end = skipDigits(source, end + 1);
  if (source[end] === "e" || source[end] === "E") {
    const digits = source[end + 1] === "+" || source[end + 1] === "-" ? end + 2 : end + 1;
    if (isDigit(source[digits])) end = skipDigits(source, digits);
  }
  return end;
};

const readString = (source: string, start: number) => {
  const quote = source[start];
  let text = "";
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === quote) return { text, end: index + 1 };
    if (character === "\\" && index + 1 < source.length) {
      index += 1;
      text += STRING_ESCAPES[source[index]] ?? source[index];
    } else {
      text += character;
    }
  }
  throw syntaxError("This text is missing its closing quote", start);
};

const tokenize = (source: string): Token[] => {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (/\s/.test(character)) {
      index += 1;
    } else if (isDigit(character) || (character === "." && isDigit(source[index + 1]))) {
      const end = numberEnd(source, index);
      tokens.push({ kind: "number", value: Number(source.slice(index, end)), position: index });
      index = end;
    } else if (character === "\"" || character === "'") {
      const { text, end } = readString(source, index);
      tokens.push({ kind: "string", value: text, position: index });
      index = end;
    } else if (isNameStart(character)) {
      let end = index + 1;
      while (isNamePart(source[end])) end += 1;
      tokens.push({ kind: "name", value: source.slice(index, end), position: index });
      index = end;
    } else {
      const symbol = SYMBOLS.find((candidate) => source.startsWith(candidate, index));
      if (!symbol) {
        const hint = character === "=" ? " (use == to compare)" : "";
        throw syntaxError(`Unexpected "${character}"${hint}`, index);
      }
      tokens.push({ kind: "symbol", value: symbol, position: index });
      index += symbol.length;
    }
  }
  tokens.push({ kind: "end", value: "", position: source.length });
  return tokens;
};

const BINARY_PRECEDENCE: Record<BinaryOperator, number> = {
  "||": 1,
  "&&": 2,
  "==": 3,
  "!=": 3,
  ">": 4,
  "<": 4,
  ">=": 4,
  "<=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "%": 6,
  "^": 7,
};

const describeToken = (token: Token) => token.kind === "end" ? "the end of the formula" : `"${token.value}"`;

const binaryOperatorOf = (token: Token): BinaryOperator | null => {
  if (token.kind === "name") {
    const word = token.value.toLowerCase();
    return word === "and" ? "&&" : word === "or" ? "||" : null;
  }
  if (token.kind === "symbol" && token.value !== "^" && Object.hasOwn(BINARY_PRECEDENCE, token.value)) {
    return token.value as BinaryOperator;
  }
  return null;
};

export const parseFormula = (expression: string): FormulaAst => {
  const tokens = tokenize(expression);
  let index = 0;
  let depth = -1;

  const current = () => tokens[index];
  const advance = () => tokens[index++];
  const isSymbol = (symbol: string, token = current()) => token.kind === "symbol" && token.value === symbol;

  const expectSymbol = (symbol: string) => {
    if (!isSymbol(symbol)) throw syntaxError(`Expected "${symbol}" but found ${describeToken(current())}`, current().position);
    return advance();
  };

  const nested = (parse: () => FormulaAst) => {
    depth += 1;
    if (depth > MAX_NESTING) {
      throw syntaxError(`This formula is nested more than ${MAX_NESTING} levels deep`, current().position);
    }
    const node = parse();
    depth -= 1;
    return node;
  };

  const parseExpression = (): FormulaAst => nested(() => {
    const condition = parseBinary(1);
    if (!isSymbol("?")) return condition;
    const { position } = advance();
    const consequent = parseExpression();
    expectSymbol(":");
    return { type: "ternary", condition, consequent, alternate: parseExpression(), position };
  });

  const parseBinary = (minimum: number): FormulaAst => {
    let left = parseUnary();
    for (;;) {
      const operator = binaryOperatorOf(current());
      if (!operator || BINARY_PRECEDENCE[operator] < minimum) return left;
      const { position } = advance();
      left = { type: "binary", operator, left, right: parseBinary(BINARY_PRECEDENCE[operator] + 1), position };
    }
  };

  const parseUnary = (): FormulaAst => {
    const token = current();
    const isWordNot = token.kind === "name" && token.value.toLowerCase() === "not" && !isSymbol("(", tokens[index + 1]);
    if (isSymbol("-") || isSymbol("!") || isWordNot) {
      advance();
      const operator = isSymbol("-", token) ? "-" : "!";
      return { type: "unary", operator, operand: nested(parseUnary), position: token.position };
    }
    return parsePower();
  };

  const parsePower = (): FormulaAst => {
    const left = parsePostfix();
    if (!isSymbol("^")) return left;
    const { position } = advance();
    return { type: "binary", operator: "^", left, right: nested(parseUnary), position };
  };

  const parseArguments = (close: string) => {
    const items: FormulaAst[] = [];
    if (!isSymbol(close)) {
      items.push(parseExpression());
      while (isSymbol(",")) {
        advance();
        items.push(parseExpression());
      }
    }
    expectSymbol(close);
    return items;
  };

  const callNode = (name: string, args: FormulaAst[], position: number): FormulaAst => {
    const canonical = name.toLowerCase();
    const problem = callProblem(canonical, args.length);
    if (problem) throw syntaxError(problem, position);
    return { type: "call", name: canonical, args, position };
  };

  const parsePostfix = (): FormulaAst => {
    let node = parsePrimary();
    let chained = 0;
    while (isSymbol(".")) {
      advance();
      const method = current();
      if (method.kind !== "name") throw syntaxError(`Expected a function name but found ${describeToken(method)}`, method.position);
      advance();
      chained += 1;
      if (depth + chained > MAX_NESTING) {
        throw syntaxError(`This formula is nested more than ${MAX_NESTING} levels deep`, method.position);
      }
      if (!isSymbol("(")) throw syntaxError(`Expected "(" after ${method.value}`, current().position);
      advance();
      node = callNode(method.value, [node, ...parseArguments(")")], method.position);
    }
    return node;
  };

  const parsePrimary = (): FormulaAst => {
    const token = advance();
    if (token.kind === "number" || token.kind === "string") {
      return { type: "literal", value: token.value, position: token.position };
    }
    if (token.kind === "name") {
      const word = token.value.toLowerCase();
      if (word === "true" || word === "false") return { type: "literal", value: word === "true", position: token.position };
      if (!isSymbol("(")) throw syntaxError(`Unknown name "${token.value}" (use prop("${token.value}") for a property)`, token.position);
      advance();
      return callNode(token.value, parseArguments(")"), token.position);
    }
    if (isSymbol("(", token)) {
      const inner = parseExpression();
      expectSymbol(")");
      return inner;
    }
    if (isSymbol("[", token)) return { type: "list", items: parseArguments("]"), position: token.position };
    throw syntaxError(`Unexpected ${describeToken(token)}`, token.position);
  };

  const ast = parseExpression();
  if (current().kind !== "end") throw syntaxError(`Unexpected ${describeToken(current())}`, current().position);
  return ast;
};

type EvaluationState = { context: FormulaContext; steps: number };
type Call = { name: string; position: number; state: EvaluationState };
type EagerFunction = {
  min: number;
  max: number;
  nullable: boolean;
  run: (args: FormulaValue[], call: Call) => FormulaValue;
};
type LazyFunction = {
  min: number;
  max: number;
  lazy: (args: FormulaAst[], state: EvaluationState) => FormulaValue;
};
type DateUnit = "year" | "quarter" | "month" | "week" | "day" | "hour" | "minute" | "second";

const DATE_UNITS = new Set<string>(["year", "quarter", "month", "week", "day", "hour", "minute", "second"]);
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DATE_PATTERN_TOKEN = /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|mm|ss|A/g;

const collator = new Intl.Collator(undefined, { numeric: true });
const pad = (value: number, length = 2) => String(value).padStart(length, "0");

const formatDatePattern = (date: Date, pattern: string) =>
  pattern.replace(DATE_PATTERN_TOKEN, (token, literal: string | undefined) => {
    if (literal !== undefined) return literal;
    switch (token) {
      case "YYYY": return pad(date.getFullYear(), 4);
      case "YY": return pad(date.getFullYear() % 100);
      case "MMMM": return MONTH_NAMES[date.getMonth()];
      case "MMM": return MONTH_NAMES[date.getMonth()].slice(0, 3);
      case "MM": return pad(date.getMonth() + 1);
      case "M": return String(date.getMonth() + 1);
      case "DD": return pad(date.getDate());
      case "D": return String(date.getDate());
      case "dddd": return DAY_NAMES[date.getDay()];
      case "ddd": return DAY_NAMES[date.getDay()].slice(0, 3);
      case "HH": return pad(date.getHours());
      case "mm": return pad(date.getMinutes());
      case "ss": return pad(date.getSeconds());
      default: return date.getHours() < 12 ? "AM" : "PM";
    }
  });

const isLocalMidnight = (date: Date) =>
  date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0 && date.getMilliseconds() === 0;

const displayDate = (date: Date) => formatDatePattern(date, isLocalMidnight(date) ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm");

/** Trims binary floating-point noise so 0.1 + 0.2 shows as 0.3. */
const formatPlainNumber = (value: number) => String(Number(value.toPrecision(15)));

const formatValue = (value: FormulaValue): string => {
  if (value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return formatPlainNumber(value);
  if (typeof value === "boolean") return String(value);
  if (value instanceof Date) return displayDate(value);
  return value.map(formatValue).join(", ");
};

const parseStoredDate = (text: string): Date | null => {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (dateOnly) {
    const [year, month, day] = [Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])];
    const local = new Date(2000, 0, 1);
    local.setFullYear(year, month, day);
    return local.getMonth() === month && local.getDate() === day ? local : null;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const typeName = (value: FormulaValue) => {
  if (value === null) return "nothing";
  if (Array.isArray(value)) return "a list";
  if (value instanceof Date) return "a date";
  return typeof value === "string" ? "text" : typeof value === "number" ? "a number" : "true/false";
};

const isTruthy = (value: FormulaValue) => {
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== false && value !== 0 && value !== "";
};

const clean = (value: FormulaValue): FormulaValue => {
  if (typeof value === "number") return Number.isFinite(value) ? value + 0 : null;
  return value instanceof Date && Number.isNaN(value.getTime()) ? null : value;
};

const valuesEqual = (left: FormulaValue, right: FormulaValue): boolean => {
  if (left instanceof Date || right instanceof Date) {
    return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((item, index) => valuesEqual(item, right[index]));
  }
  return left === right;
};

const limitText = (text: string, position: number) => {
  if (text.length > MAX_TEXT_LENGTH) throw new FormulaError("This text is too long to work with", position);
  return text;
};

const charge = (state: EvaluationState, cost: number, position: number | null) => {
  state.steps += cost;
  if (state.steps > MAX_STEPS) throw new FormulaError("This formula takes too many steps to calculate", position);
};

const compareForOperator = (left: FormulaValue, right: FormulaValue, operator: string, position: number) => {
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "string" && typeof right === "string") return left < right ? -1 : left > right ? 1 : 0;
  if (left instanceof Date && right instanceof Date) return left.getTime() - right.getTime();
  if (typeof left === "boolean" && typeof right === "boolean") return Number(left) - Number(right);
  throw new FormulaError(`Cannot use ${operator} with ${typeName(left)} and ${typeName(right)}`, position);
};

const arithmetic = (operator: BinaryOperator, left: number, right: number): FormulaValue => {
  switch (operator) {
    case "+": return left + right;
    case "-": return left - right;
    case "*": return left * right;
    case "/": return right === 0 ? null : left / right;
    case "%": return right === 0 ? null : left % right;
    default: return left ** right;
  }
};

const applyBinary = (operator: BinaryOperator, left: FormulaValue, right: FormulaValue, position: number): FormulaValue => {
  if (operator === "==") return valuesEqual(left, right);
  if (operator === "!=") return !valuesEqual(left, right);
  if (left === null || right === null) return null;
  if (operator === "+" && (typeof left === "string" || typeof right === "string")) {
    return limitText(formatValue(left) + formatValue(right), position);
  }
  if (operator === ">" || operator === "<" || operator === ">=" || operator === "<=") {
    const order = compareForOperator(left, right, operator, position);
    return operator === ">" ? order > 0 : operator === "<" ? order < 0 : operator === ">=" ? order >= 0 : order <= 0;
  }
  if (typeof left !== "number" || typeof right !== "number") {
    throw new FormulaError(`Cannot use ${operator} with ${typeName(left)} and ${typeName(right)}`, position);
  }
  return clean(arithmetic(operator, left, right));
};

const numberArgument = (value: FormulaValue, call: Call) => {
  if (typeof value !== "number") throw new FormulaError(`${call.name} expects a number but got ${typeName(value)}`, call.position);
  return value;
};

const dateArgument = (value: FormulaValue, call: Call) => {
  const date = value instanceof Date ? value : typeof value === "string" ? parseStoredDate(value) : null;
  if (!date) throw new FormulaError(`${call.name} expects a date but got ${typeName(value)}`, call.position);
  return date;
};

const unitArgument = (value: FormulaValue, call: Call): DateUnit => {
  const unit = formatValue(value).trim().toLowerCase().replace(/s$/, "");
  if (!DATE_UNITS.has(unit)) throw new FormulaError(`"${formatValue(value)}" is not a date unit`, call.position);
  return unit as DateUnit;
};

const toList = (value: FormulaValue): FormulaValue[] => Array.isArray(value) ? value : value === null ? [] : [value];

const flatten = (values: FormulaValue[]): FormulaValue[] =>
  values.flatMap((value) => Array.isArray(value) ? flatten(value) : [value]);

const numbersFrom = (args: FormulaValue[], call: Call) => {
  const values = flatten(args);
  charge(call.state, values.length, call.position);
  return values.filter((value) => value !== null).map((value) => numberArgument(value, call));
};

const addMonths = (date: Date, months: number) => {
  const result = new Date(date.getTime());
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDay));
  return result;
};

const addDays = (date: Date, days: number) => {
  const result = new Date(date.getTime());
  result.setDate(result.getDate() + days);
  return result;
};

const addToDate = (date: Date, amount: number, unit: DateUnit) => {
  const whole = Math.trunc(amount);
  switch (unit) {
    case "year": return addMonths(date, whole * 12);
    case "quarter": return addMonths(date, whole * 3);
    case "month": return addMonths(date, whole);
    case "week": return addDays(date, whole * 7);
    case "day": return addDays(date, whole);
    case "hour": return new Date(date.getTime() + amount * HOUR_MS);
    case "minute": return new Date(date.getTime() + amount * MINUTE_MS);
    case "second": return new Date(date.getTime() + amount * SECOND_MS);
  }
};

const wholeMonthsBetween = (earlier: Date, later: Date) => {
  const months = (later.getFullYear() - earlier.getFullYear()) * 12 + later.getMonth() - earlier.getMonth();
  return addMonths(earlier, months) > later ? months - 1 : months;
};

const wholeDaysBetween = (earlier: Date, later: Date) => {
  const days = Math.round(
    (Date.UTC(later.getFullYear(), later.getMonth(), later.getDate())
      - Date.UTC(earlier.getFullYear(), earlier.getMonth(), earlier.getDate())) / DAY_MS,
  );
  return addDays(earlier, days) > later ? days - 1 : days;
};

const dateBetween = (left: Date, right: Date, unit: DateUnit) => {
  const sign = left >= right ? 1 : -1;
  const [earlier, later] = sign > 0 ? [right, left] : [left, right];
  const span = later.getTime() - earlier.getTime();
  const magnitude = (() => {
    switch (unit) {
      case "year": return Math.trunc(wholeMonthsBetween(earlier, later) / 12);
      case "quarter": return Math.trunc(wholeMonthsBetween(earlier, later) / 3);
      case "month": return wholeMonthsBetween(earlier, later);
      case "week": return Math.trunc(wholeDaysBetween(earlier, later) / 7);
      case "day": return wholeDaysBetween(earlier, later);
      case "hour": return Math.trunc(span / HOUR_MS);
      case "minute": return Math.trunc(span / MINUTE_MS);
      case "second": return Math.trunc(span / SECOND_MS);
    }
  })();
  return sign * magnitude;
};

const startOfDate = (date: Date, unit: DateUnit) => {
  const result = new Date(date.getTime());
  switch (unit) {
    case "year":
      result.setMonth(0, 1);
      result.setHours(0, 0, 0, 0);
      break;
    case "quarter":
      result.setMonth(result.getMonth() - (result.getMonth() % 3), 1);
      result.setHours(0, 0, 0, 0);
      break;
    case "month":
      result.setDate(1);
      result.setHours(0, 0, 0, 0);
      break;
    case "week":
      result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
      result.setHours(0, 0, 0, 0);
      break;
    case "day":
      result.setHours(0, 0, 0, 0);
      break;
    case "hour":
      result.setMinutes(0, 0, 0);
      break;
    case "minute":
      result.setSeconds(0, 0);
      break;
    case "second":
      result.setMilliseconds(0);
      break;
  }
  return result;
};

const endOfDate = (date: Date, unit: DateUnit) =>
  new Date(addToDate(startOfDate(date, unit), 1, unit).getTime() - 1);

const shiftDecimal = (value: number, places: number) => {
  const [mantissa, exponent = "0"] = String(value).split("e");
  return Number(`${mantissa}e${Number(exponent) + places}`);
};

const roundNumber = (value: number, places: number) => shiftDecimal(Math.round(shiftDecimal(value, places)), -places);

const isRepeatAt = (pattern: string, index: number) =>
  pattern[index] === "*" || pattern[index] === "+" || (pattern[index] === "{" && /^\{\d+(,\d*)?\}/.test(pattern.slice(index)));

const characterClassEnd = (pattern: string, start: number) => {
  let index = start + 1;
  if (pattern[index] === "^") index += 1;
  while (index < pattern.length && pattern[index] !== "]") index += pattern[index] === "\\" ? 2 : 1;
  return index;
};

/** Backreferences and repeated groups that themselves repeat or branch are what make backtracking explode. */
const isBacktrackingProne = (pattern: string) => {
  const groups = [{ branching: false }];
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "\\") {
      if (/[1-9]/.test(pattern[index + 1] ?? "") || (pattern[index + 1] === "k" && pattern[index + 2] === "<")) return true;
      index += 1;
    } else if (character === "[") {
      index = characterClassEnd(pattern, index);
    } else if (character === "(") {
      groups.push({ branching: false });
    } else if (character === ")") {
      const closed = groups.pop();
      if (closed?.branching && isRepeatAt(pattern, index + 1)) return true;
      if (groups.length === 0) groups.push({ branching: false });
      if (closed?.branching) groups[groups.length - 1].branching = true;
    } else if (character === "|" || isRepeatAt(pattern, index)) {
      groups[groups.length - 1].branching = true;
    }
  }
  return false;
};

const compileRegex = (pattern: string, call: Call) => {
  if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
    throw new FormulaError(`Patterns can be at most ${MAX_REGEX_PATTERN_LENGTH} characters long`, call.position);
  }
  if (isBacktrackingProne(pattern)) throw new FormulaError("This pattern could take too long to run", call.position);
  try {
    return new RegExp(pattern);
  } catch {
    throw new FormulaError(`"${pattern}" is not a valid pattern`, call.position);
  }
};

const compareNonNull = (left: FormulaValue, right: FormulaValue) => {
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (left instanceof Date && right instanceof Date) return left.getTime() - right.getTime();
  if (typeof left === "boolean" && typeof right === "boolean") return Number(left) - Number(right);
  return collator.compare(formatValue(left), formatValue(right));
};

const identityKey = (value: FormulaValue): string => {
  if (value === null) return "null";
  if (value instanceof Date) return `date:${value.getTime()}`;
  if (Array.isArray(value)) return `[${value.map(identityKey).join(",")}]`;
  return JSON.stringify(value);
};

const contains = (args: FormulaValue[], call: Call) => {
  if (Array.isArray(args[0])) {
    charge(call.state, args[0].length, call.position);
    return args[0].some((item) => valuesEqual(item, args[1]));
  }
  return formatValue(args[0]).includes(formatValue(args[1]));
};

const replaceText = (args: FormulaValue[], call: Call, all: boolean) => {
  const [text, search, replacement] = args.map(formatValue);
  const occurrences = !all ? 1 : search === "" ? text.length + 1 : text.split(search).length - 1;
  if (text.length + occurrences * replacement.length > MAX_TEXT_LENGTH) {
    throw new FormulaError("This text is too long to work with", call.position);
  }
  return all ? text.replaceAll(search, () => replacement) : text.replace(search, () => replacement);
};

const sliceValue = (args: FormulaValue[], call: Call) => {
  const start = numberArgument(args[1], call);
  const end = args.length > 2 ? numberArgument(args[2], call) : undefined;
  if (typeof args[0] === "string") return args[0].slice(start, end);
  const list = toList(args[0]);
  charge(call.state, list.length, call.position);
  return list.slice(start, end);
};

const concatValues = (args: FormulaValue[], call: Call): FormulaValue => {
  const present = args.filter((value) => value !== null);
  if (present.length > 0 && present.every(Array.isArray)) {
    const joined = present.flatMap((value) => value as FormulaValue[]);
    charge(call.state, joined.length, call.position);
    return joined;
  }
  return limitText(present.map(formatValue).join(""), call.position);
};

const toNumber = (value: FormulaValue): FormulaValue => {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value !== "string" || value.trim() === "") return null;
  return Number(value.trim());
};

const median = (values: number[]) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const eager = (min: number, max: number, run: EagerFunction["run"], nullable = false): EagerFunction => ({ min, max, run, nullable });
const lazy = (min: number, max: number, run: LazyFunction["lazy"]): LazyFunction => ({ min, max, lazy: run });
const textFunction = (transform: (text: string) => FormulaValue) => eager(1, 1, ([value]) => transform(formatValue(value)));
const mathFunction = (transform: (value: number) => number) => eager(1, 1, ([value], call) => transform(numberArgument(value, call)));
const operatorFunction = (operator: BinaryOperator) => eager(2, 2, ([left, right], call) => applyBinary(operator, left, right, call.position));
const dateFunction = (read: (date: Date) => FormulaValue) => eager(1, 1, ([value], call) => read(dateArgument(value, call)));
const aggregateFunction = (reduce: (values: number[]) => FormulaValue) => eager(1, Infinity, (args, call) => reduce(numbersFrom(args, call)), true);
const listFunction = (transform: (list: FormulaValue[], args: FormulaValue[], call: Call) => FormulaValue, min = 1, max = 1) =>
  eager(min, max, (args, call) => {
    const list = toList(args[0]);
    charge(call.state, list.length, call.position);
    return transform(list, args, call);
  });

const FUNCTIONS = new Map<string, EagerFunction | LazyFunction>(Object.entries({
  prop: eager(1, 1, ([name], call) => {
    if (typeof name !== "string") throw new FormulaError(`prop expects text but got ${typeName(name)}`, call.position);
    return call.state.context.getProperty(name);
  }),

  if: lazy(3, 3, ([condition, consequent, alternate], state) =>
    evaluate(isTruthy(evaluate(condition, state)) ? consequent : alternate, state)),
  ifs: lazy(2, Infinity, (nodes, state) => {
    for (let index = 0; index + 1 < nodes.length; index += 2) {
      if (isTruthy(evaluate(nodes[index], state))) return evaluate(nodes[index + 1], state);
    }
    return nodes.length % 2 === 1 ? evaluate(nodes[nodes.length - 1], state) : null;
  }),
  and: lazy(1, Infinity, (nodes, state) => nodes.every((node) => isTruthy(evaluate(node, state)))),
  or: lazy(1, Infinity, (nodes, state) => nodes.some((node) => isTruthy(evaluate(node, state)))),
  not: eager(1, 1, ([value]) => !isTruthy(value), true),
  empty: eager(1, 1, ([value]) => value === null || value === "" || (Array.isArray(value) && value.length === 0), true),

  length: eager(1, 1, ([value]) => Array.isArray(value) ? value.length : formatValue(value).length),
  contains: eager(2, 2, contains),
  includes: eager(2, 2, contains),
  test: eager(2, 2, ([value, pattern], call) => {
    const text = formatValue(value);
    if (text.length > MAX_REGEX_INPUT_LENGTH) {
      throw new FormulaError(`Patterns can test at most ${MAX_REGEX_INPUT_LENGTH} characters of text`, call.position);
    }
    return compileRegex(formatValue(pattern), call).test(text);
  }),
  replace: eager(3, 3, (args, call) => replaceText(args, call, false)),
  replaceall: eager(3, 3, (args, call) => replaceText(args, call, true)),
  lower: textFunction((text) => text.toLowerCase()),
  upper: textFunction((text) => text.toUpperCase()),
  trim: textFunction((text) => text.trim()),
  substring: eager(2, 3, (args, call) => {
    const end = args.length > 2 ? numberArgument(args[2], call) : undefined;
    return formatValue(args[0]).substring(numberArgument(args[1], call), end);
  }),
  concat: eager(1, Infinity, concatValues, true),
  join: eager(1, 2, (args, call) => {
    const list = toList(args[0]);
    charge(call.state, list.length, call.position);
    return limitText(list.map(formatValue).join(args.length > 1 ? formatValue(args[1]) : ", "), call.position);
  }),
  split: eager(2, 2, ([value, separator], call) => {
    const parts = formatValue(value).split(formatValue(separator));
    charge(call.state, parts.length, call.position);
    return parts;
  }),
  format: eager(1, 1, ([value]) => formatValue(value), true),
  tonumber: eager(1, 1, ([value]) => toNumber(value)),

  add: operatorFunction("+"),
  subtract: operatorFunction("-"),
  multiply: operatorFunction("*"),
  divide: operatorFunction("/"),
  mod: operatorFunction("%"),
  pow: operatorFunction("^"),
  round: eager(1, 2, (args, call) => roundNumber(
    numberArgument(args[0], call),
    args.length > 1 ? Math.trunc(numberArgument(args[1], call)) : 0,
  )),
  floor: mathFunction(Math.floor),
  ceil: mathFunction(Math.ceil),
  abs: mathFunction(Math.abs),
  sqrt: mathFunction(Math.sqrt),
  min: aggregateFunction((values) => values.length ? values.reduce((left, right) => Math.min(left, right)) : null),
  max: aggregateFunction((values) => values.length ? values.reduce((left, right) => Math.max(left, right)) : null),
  sum: aggregateFunction((values) => values.reduce((total, value) => total + value, 0)),
  mean: aggregateFunction((values) => values.length ? values.reduce((total, value) => total + value, 0) / values.length : null),
  median: aggregateFunction(median),

  now: eager(0, 0, (_args, call) => new Date(call.state.context.now.getTime()), true),
  today: eager(0, 0, (_args, call) => startOfDate(call.state.context.now, "day"), true),
  timestamp: dateFunction((date) => date.getTime()),
  fromtimestamp: eager(1, 1, ([value], call) => new Date(numberArgument(value, call))),
  dateadd: eager(3, 3, ([date, amount, unit], call) =>
    addToDate(dateArgument(date, call), numberArgument(amount, call), unitArgument(unit, call))),
  datesubtract: eager(3, 3, ([date, amount, unit], call) =>
    addToDate(dateArgument(date, call), -numberArgument(amount, call), unitArgument(unit, call))),
  datebetween: eager(3, 3, ([left, right, unit], call) =>
    dateBetween(dateArgument(left, call), dateArgument(right, call), unitArgument(unit, call))),
  datestart: eager(1, 2, (args, call) => startOfDate(dateArgument(args[0], call), args.length > 1 ? unitArgument(args[1], call) : "day")),
  dateend: eager(1, 2, (args, call) => endOfDate(dateArgument(args[0], call), args.length > 1 ? unitArgument(args[1], call) : "day")),
  formatdate: eager(2, 2, ([date, pattern], call) => formatDatePattern(dateArgument(date, call), formatValue(pattern))),
  year: dateFunction((date) => date.getFullYear()),
  month: dateFunction((date) => date.getMonth() + 1),
  date: dateFunction((date) => date.getDate()),
  day: dateFunction((date) => ((date.getDay() + 6) % 7) + 1),
  hour: dateFunction((date) => date.getHours()),
  minute: dateFunction((date) => date.getMinutes()),

  first: listFunction((list) => list.length ? list[0] : null),
  last: listFunction((list) => list.length ? list[list.length - 1] : null),
  at: listFunction((list, args, call) => list.at(Math.trunc(numberArgument(args[1], call))) ?? null, 2, 2),
  slice: eager(2, 3, sliceValue),
  sort: listFunction((list) => [...list].sort((left, right) => {
    if (left === null || right === null) return Number(left === null) - Number(right === null);
    return compareNonNull(left, right);
  })),
  reverse: listFunction((list) => [...list].reverse()),
  unique: listFunction((list) => {
    const seen = new Set<string>();
    return list.filter((item) => {
      const key = identityKey(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }),
}));

const callProblem = (name: string, count: number): string | null => {
  const definition = FUNCTIONS.get(name);
  if (!definition) return `Unknown function "${name}"`;
  if (count >= definition.min && count <= definition.max) return null;
  const expected = definition.min === definition.max
    ? String(definition.min)
    : definition.max === Infinity ? `at least ${definition.min}` : `${definition.min} to ${definition.max}`;
  return `${name} expects ${expected} argument${expected === "1" ? "" : "s"} but got ${count}`;
};

/** Left-leaning operator chains can be arbitrarily long without being nested, so they are walked iteratively. */
const evaluateBinary = (root: Extract<FormulaAst, { type: "binary" }>, state: EvaluationState) => {
  const spine = [root];
  let leftmost = root.left;
  while (leftmost.type === "binary") {
    spine.push(leftmost);
    leftmost = leftmost.left;
  }
  let value = evaluate(leftmost, state);
  for (let index = spine.length - 1; index >= 0; index -= 1) {
    const node = spine[index];
    charge(state, 1, node.position);
    if (node.operator === "&&") value = isTruthy(value) && isTruthy(evaluate(node.right, state));
    else if (node.operator === "||") value = isTruthy(value) || isTruthy(evaluate(node.right, state));
    else value = applyBinary(node.operator, value, evaluate(node.right, state), node.position);
  }
  return value;
};

const evaluateCall = (node: Extract<FormulaAst, { type: "call" }>, state: EvaluationState): FormulaValue => {
  const problem = callProblem(node.name, node.args.length);
  if (problem) throw new FormulaError(problem, node.position);
  const definition = FUNCTIONS.get(node.name) as EagerFunction | LazyFunction;
  if ("lazy" in definition) return definition.lazy(node.args, state);
  const args = node.args.map((argument) => evaluate(argument, state));
  if (!definition.nullable && args.some((argument) => argument === null)) return null;
  return clean(definition.run(args, { name: node.name, position: node.position, state }));
};

const evaluate = (node: FormulaAst, state: EvaluationState): FormulaValue => {
  charge(state, 1, node.position);
  switch (node.type) {
    case "literal": return clean(node.value);
    case "list": return node.items.map((item) => evaluate(item, state));
    case "unary": {
      const operand = evaluate(node.operand, state);
      if (node.operator === "!") return !isTruthy(operand);
      if (operand === null) return null;
      if (typeof operand !== "number") throw new FormulaError(`Cannot negate ${typeName(operand)}`, node.position);
      return clean(-operand);
    }
    case "binary": return evaluateBinary(node, state);
    case "ternary": return evaluate(isTruthy(evaluate(node.condition, state)) ? node.consequent : node.alternate, state);
    case "call": return evaluateCall(node, state);
  }
};

export const evaluateFormula = (ast: FormulaAst, context: FormulaContext): FormulaValue => {
  try {
    return evaluate(ast, { context, steps: 0 });
  } catch (error) {
    if (error instanceof RangeError) throw new FormulaError("This formula is too large to calculate");
    throw error;
  }
};

export type ComputedCell = { value: FormulaValue; display: string; error?: string };
export type ComputedRowValues = Map<string, Record<string, ComputedCell>>;
export type DatabaseRelatedRows = Record<string, { schema: DatabaseSchema; rows: DatabaseRow[] }>;
export type DatabaseRowGroup = { key: string; label: string; color?: string; optionId: string | null; rows: DatabaseRow[] };

type NumberFormat = DatabaseProperty["numberFormat"];

const CURRENCY_SYMBOLS: Partial<Record<NonNullable<NumberFormat>, string>> = { dollar: "$", euro: "€", pound: "£", yen: "¥" };

const formatNumber = (value: number, format: NumberFormat) => {
  if (format === "percent") return `${formatPlainNumber(value)}%`;
  const symbol = format ? CURRENCY_SYMBOLS[format] : undefined;
  if (!symbol) return formatPlainNumber(value);
  const magnitude = Math.abs(value);
  const amount = format === "yen" || Number.isInteger(magnitude) ? formatPlainNumber(magnitude) : magnitude.toFixed(2);
  return `${value < 0 ? "-" : ""}${symbol}${amount}`;
};

const emptyCell = (): ComputedCell => ({ value: null, display: "" });
const errorCell = (error: string): ComputedCell => ({ value: null, display: "", error });
const valueCell = (value: FormulaValue): ComputedCell => ({ value, display: formatValue(value) });
const numberCell = (value: number | null, format: NumberFormat): ComputedCell =>
  value === null ? emptyCell() : { value, display: formatNumber(value, format) };

const isBlank = (value: FormulaValue) => value === null || value === "" || (Array.isArray(value) && value.length === 0);
const isEmptyForType = (value: FormulaValue, type: DatabaseProperty["type"]) =>
  isBlank(value) || (value === false && type !== "checkbox");

const storedStrings = (stored: DatabasePropertyValue | undefined): string[] => {
  if (Array.isArray(stored)) return stored.filter((item): item is string => typeof item === "string");
  return typeof stored === "string" && stored !== "" ? [stored] : [];
};

const findOption = (property: DatabaseProperty, stored: string): DatabaseOption | null =>
  property.options?.find((option) => option.id === stored)
    ?? property.options?.find((option) => option.name === stored)
    ?? null;

const selectedOptions = (property: DatabaseProperty, stored: DatabasePropertyValue | undefined) =>
  storedStrings(stored).flatMap((id) => findOption(property, id) ?? []);

const storedDateValue = (stored: DatabasePropertyValue | undefined): DatabaseDateValue | null => {
  if (typeof stored === "string") return { start: stored };
  if (stored && typeof stored === "object" && !Array.isArray(stored)) return stored;
  return null;
};

const dateCell = (stored: DatabasePropertyValue | undefined): ComputedCell => {
  const range = storedDateValue(stored);
  const start = range ? parseStoredDate(range.start) : null;
  if (!range || !start) return emptyCell();
  const end = range.end ? parseStoredDate(range.end) : null;
  return { value: start, display: end ? `${displayDate(start)} → ${displayDate(end)}` : displayDate(start) };
};

const timestampCell = (stored: string) => valueCell(parseStoredDate(stored));

const storedFileNames = (stored: DatabasePropertyValue | undefined): string[] =>
  (Array.isArray(stored) ? stored.flatMap((item) => (item && typeof item === "object" && "name" in item ? [item.name] : [])) : []);

/** "TASK-12", or just "12" without a prefix. */
export const formatRowId = (number: number, prefix?: string) => (prefix ? `${prefix}-${number}` : String(number));

const applyRollup = (
  rollup: NonNullable<DatabaseProperty["rollup"]>["function"],
  cells: ComputedCell[],
  target: DatabaseProperty,
  property: DatabaseProperty,
): ComputedCell => {
  const values = flatten(cells.map((cell) => cell.value)).filter((value) => value !== null && value !== "");
  const numbers = values.filter((value): value is number => typeof value === "number");
  const dates = values.filter((value): value is Date => value instanceof Date);
  const format = property.numberFormat ?? target.numberFormat;
  switch (rollup) {
    case "show_original":
      return { value: values, display: cells.map((cell) => cell.display).filter(Boolean).join(", ") };
    case "count":
      return numberCell(cells.length, property.numberFormat);
    case "count_values":
      return numberCell(cells.filter((cell) => !isEmptyForType(cell.value, target.type)).length, property.numberFormat);
    case "sum":
      return numberCell(clean(numbers.reduce((total, value) => total + value, 0)) as number | null, format);
    case "average":
      return numberCell(numbers.length ? numbers.reduce((total, value) => total + value, 0) / numbers.length : null, format);
    case "min":
      return numberCell(numbers.length ? numbers.reduce((left, right) => Math.min(left, right)) : null, format);
    case "max":
      return numberCell(numbers.length ? numbers.reduce((left, right) => Math.max(left, right)) : null, format);
    case "percent_checked": {
      const percent = cells.length ? (cells.filter((cell) => cell.value === true).length / cells.length) * 100 : 0;
      return { value: percent, display: `${formatPlainNumber(roundNumber(percent, 2))}%` };
    }
    case "earliest":
      return valueCell(dates.length ? dates.reduce((left, right) => left <= right ? left : right) : null);
    case "latest":
      return valueCell(dates.length ? dates.reduce((left, right) => left >= right ? left : right) : null);
  }
};

type Dataset = {
  schema: DatabaseSchema;
  rows: Map<string, DatabaseRow>;
  propertiesById: Map<string, DatabaseProperty>;
  propertiesByName: Map<string, DatabaseProperty>;
  cells: Map<string, ComputedCell>;
  computing: Set<string>;
};

const createDataset = (schema: DatabaseSchema, rows: DatabaseRow[]): Dataset => ({
  schema,
  rows: new Map(rows.map((row) => [row.id, row])),
  propertiesById: new Map(schema.properties.map((property) => [property.id, property])),
  propertiesByName: new Map([...schema.properties].reverse().map((property) => [property.name, property])),
  cells: new Map(),
  computing: new Set(),
});

export const computeRowValues = (input: {
  schema: DatabaseSchema;
  rows: DatabaseRow[];
  relatedRows: DatabaseRelatedRows;
  now?: Date;
  /** Names of workspace members by user id, so person values filter, sort and group by name. */
  people?: ReadonlyMap<string, string>;
}): ComputedRowValues => {
  const now = input.now ?? new Date();
  const personName = (id: string) => input.people?.get(id) ?? id;
  const primary = createDataset(input.schema, input.rows);
  const relatedDatasets = new Map<string, Dataset>();
  const parsedFormulas = new Map<string, FormulaAst | FormulaError>();

  /** A database that is not in relatedRows is the current one: its row ids simply will not resolve otherwise. */
  const datasetFor = (databaseId: string | undefined) => {
    if (databaseId === undefined || !Object.hasOwn(input.relatedRows, databaseId)) return primary;
    let dataset = relatedDatasets.get(databaseId);
    if (!dataset) {
      const related = input.relatedRows[databaseId];
      dataset = createDataset(related.schema, related.rows);
      relatedDatasets.set(databaseId, dataset);
    }
    return dataset;
  };

  const parseOnce = (expression: string) => {
    let parsed = parsedFormulas.get(expression);
    if (!parsed) {
      try {
        parsed = parseFormula(expression);
      } catch (error) {
        parsed = error instanceof FormulaError ? error : new FormulaError("This formula could not be read");
      }
      parsedFormulas.set(expression, parsed);
    }
    return parsed;
  };

  const relatedRowsOf = (dataset: Dataset, stored: DatabasePropertyValue | undefined) =>
    storedStrings(stored).flatMap((id) => dataset.rows.get(id) ?? []);

  const formulaCell = (dataset: Dataset, row: DatabaseRow, property: DatabaseProperty, depth: number): ComputedCell => {
    const expression = property.formula?.expression ?? "";
    if (expression.trim() === "") return emptyCell();
    const parsed = parseOnce(expression);
    if (parsed instanceof FormulaError) return errorCell(parsed.message);
    const value = evaluateFormula(parsed, {
      now,
      getProperty: (name) => {
        const referenced = dataset.propertiesByName.get(name);
        if (!referenced) throw new FormulaError(`There is no property named "${name}"`);
        const cell = computeCell(dataset, row, referenced, depth + 1);
        if (cell.error) throw new FormulaError(cell.error);
        return cell.value;
      },
    });
    return typeof value === "number" ? numberCell(value, property.numberFormat) : valueCell(value);
  };

  const rollupCell = (dataset: Dataset, row: DatabaseRow, property: DatabaseProperty, depth: number): ComputedCell => {
    const config = property.rollup;
    const relation = config ? dataset.propertiesById.get(config.relationPropertyId) : undefined;
    if (!config || !relation || relation.type !== "relation") return errorCell("The relation for this rollup no longer exists");
    const targetDataset = datasetFor(relation.relation?.databaseId);
    const target = targetDataset.propertiesById.get(config.targetPropertyId);
    if (!target) return errorCell("The property for this rollup no longer exists");
    const cells = relatedRowsOf(targetDataset, row.properties[relation.id])
      .map((related) => computeCell(targetDataset, related, target, depth + 1));
    const failure = cells.find((cell) => cell.error)?.error;
    return failure ? errorCell(failure) : applyRollup(config.function, cells, target, property);
  };

  const computeUncached = (dataset: Dataset, row: DatabaseRow, property: DatabaseProperty, depth: number): ComputedCell => {
    const stored = row.properties[property.id];
    switch (property.type) {
      case "title":
        return valueCell(row.title ?? "");
      case "text":
      case "url":
      case "email":
      case "phone":
        return valueCell(typeof stored === "string" ? stored : null);
      case "number":
        return numberCell(typeof stored === "number" && Number.isFinite(stored) ? stored : null, property.numberFormat);
      case "select":
      case "status":
        return valueCell(selectedOptions(property, stored)[0]?.name ?? null);
      case "multi_select":
        return valueCell(selectedOptions(property, stored).map((option) => option.name));
      case "date":
        return dateCell(stored);
      case "checkbox":
        return valueCell(stored === true);
      case "person":
        return valueCell(storedStrings(stored).map(personName));
      case "files":
        return valueCell(storedFileNames(stored));
      case "created_by":
        return valueCell(row.createdBy ? personName(row.createdBy) : row.createdVia === "form" ? "Form" : null);
      case "last_edited_by":
        return valueCell(row.updatedBy ? personName(row.updatedBy) : null);
      case "unique_id":
        return row.number === null || row.number === undefined
          ? emptyCell()
          : { value: row.number, display: formatRowId(row.number, property.uniqueId?.prefix) };
      case "relation": {
        const related = relatedRowsOf(datasetFor(property.relation?.databaseId), stored);
        return valueCell(related.map((relatedRow) => relatedRow.title ?? ""));
      }
      case "created_time":
        return timestampCell(row.createdAt);
      case "last_edited_time":
        return timestampCell(row.updatedAt);
      case "rollup":
        return rollupCell(dataset, row, property, depth);
      case "formula":
        return formulaCell(dataset, row, property, depth);
      case "button":
        return emptyCell();
    }
  };

  const computeCell = (dataset: Dataset, row: DatabaseRow, property: DatabaseProperty, depth: number): ComputedCell => {
    const key = `${row.id}\u0000${property.id}`;
    const cached = dataset.cells.get(key);
    if (cached) return cached;
    if (dataset.computing.has(key)) return errorCell("Circular reference");
    if (depth > MAX_REFERENCE_DEPTH) return errorCell("Too many properties depend on each other here");
    dataset.computing.add(key);
    let cell: ComputedCell;
    try {
      cell = computeUncached(dataset, row, property, depth);
    } catch (error) {
      cell = errorCell(error instanceof FormulaError ? error.message : "This value could not be calculated");
    } finally {
      dataset.computing.delete(key);
    }
    dataset.cells.set(key, cell);
    return cell;
  };

  return new Map(input.rows.map((row) => [
    row.id,
    Object.fromEntries(input.schema.properties.map((property) => [property.id, computeCell(primary, row, property, 0)])),
  ]));
};

const dayNumber = (date: Date) => date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();

const isTextOperator = (operator: DatabaseFilter["operator"]) =>
  operator === "contains" || operator === "not_contains" || operator === "is" || operator === "is_not"
  || operator === "starts_with" || operator === "ends_with";

const compileTextFilter = (filter: DatabaseFilter) => {
  const raw = String(filter.value ?? "");
  if (raw.trim() === "") return null;
  const needle = raw.toLowerCase();
  const asNumber = Number(raw);
  const asDay = parseStoredDate(raw);
  const itemMatches = (cell: ComputedCell) =>
    Array.isArray(cell.value) && cell.value.some((item) => formatValue(item).toLowerCase() === needle);
  const contained = (cell: ComputedCell) =>
    Array.isArray(cell.value) ? itemMatches(cell) : cell.display.toLowerCase().includes(needle);
  const equal = (cell: ComputedCell) => {
    if (Array.isArray(cell.value)) return itemMatches(cell);
    if (typeof cell.value === "number" && cell.value === asNumber) return true;
    if (cell.value instanceof Date && asDay && dayNumber(cell.value) === dayNumber(asDay)) return true;
    return cell.display.toLowerCase() === needle;
  };
  const affix = (cell: ComputedCell, test: (text: string) => boolean) =>
    Array.isArray(cell.value)
      ? cell.value.some((item) => test(formatValue(item).toLowerCase()))
      : test(cell.display.toLowerCase());
  switch (filter.operator) {
    case "contains": return contained;
    case "not_contains": return (cell: ComputedCell) => !contained(cell);
    case "is": return equal;
    case "is_not": return (cell: ComputedCell) => !equal(cell);
    case "starts_with": return (cell: ComputedCell) => affix(cell, (text) => text.startsWith(needle));
    default: return (cell: ComputedCell) => affix(cell, (text) => text.endsWith(needle));
  }
};

const compileNumberFilter = (filter: DatabaseFilter, compare: (left: number, right: number) => boolean) => {
  if (filter.value === null || filter.value === undefined || typeof filter.value === "boolean" || String(filter.value).trim() === "") return null;
  const threshold = Number(filter.value);
  if (Number.isNaN(threshold)) return null;
  return (cell: ComputedCell) => typeof cell.value === "number" && compare(cell.value, threshold);
};

const compileDateFilter = (filter: DatabaseFilter, compare: (left: number, right: number) => boolean) => {
  const date = typeof filter.value === "string" ? parseStoredDate(filter.value) : null;
  if (!date) return null;
  const day = dayNumber(date);
  return (cell: ComputedCell) => cell.value instanceof Date && compare(dayNumber(cell.value), day);
};

/** Returns null for a filter whose value has not been filled in yet, so it has no effect under either filter mode. */
const compileFilter = (filter: DatabaseFilter, property: DatabaseProperty): ((cell: ComputedCell) => boolean) | null => {
  if (isTextOperator(filter.operator)) return compileTextFilter(filter);
  switch (filter.operator) {
    case "is_empty": return (cell) => isEmptyForType(cell.value, property.type);
    case "is_not_empty": return (cell) => !isEmptyForType(cell.value, property.type);
    case "gt": return compileNumberFilter(filter, (left, right) => left > right);
    case "gte": return compileNumberFilter(filter, (left, right) => left >= right);
    case "lt": return compileNumberFilter(filter, (left, right) => left < right);
    case "lte": return compileNumberFilter(filter, (left, right) => left <= right);
    case "before": return compileDateFilter(filter, (left, right) => left < right);
    case "after": return compileDateFilter(filter, (left, right) => left > right);
    case "on_or_before": return compileDateFilter(filter, (left, right) => left <= right);
    case "on_or_after": return compileDateFilter(filter, (left, right) => left >= right);
    case "checked": return (cell) => cell.value === true;
    default: return (cell) => cell.value !== true;
  }
};

const optionRanks = (property: DatabaseProperty) => {
  if (property.type !== "select" && property.type !== "status") return null;
  const ranks = new Map<FormulaValue, number>();
  property.options?.forEach((option, index) => {
    if (!ranks.has(option.name)) ranks.set(option.name, index);
  });
  return ranks;
};

const EMPTY_CELL: ComputedCell = { value: null, display: "" };

export const applyDatabaseView = (input: {
  schema: DatabaseSchema;
  rows: DatabaseRow[];
  cells: ComputedRowValues;
  config: DatabaseViewConfig;
  now?: Date;
}): DatabaseRow[] => {
  const { schema, rows, cells, config } = input;
  const properties = new Map(schema.properties.map((property) => [property.id, property]));
  const cellOf = (row: DatabaseRow, propertyId: string) => cells.get(row.id)?.[propertyId] ?? EMPTY_CELL;

  const filters = (config.filters ?? []).flatMap((filter) => {
    const property = properties.get(filter.propertyId);
    const matches = property ? compileFilter(filter, property) : null;
    return matches ? [{ propertyId: filter.propertyId, matches }] : [];
  });
  const passes = (row: DatabaseRow) => {
    const matchesFilter = (filter: (typeof filters)[number]) => filter.matches(cellOf(row, filter.propertyId));
    return config.filterMode === "or" ? filters.some(matchesFilter) : filters.every(matchesFilter);
  };
  const visible = filters.length > 0 ? rows.filter(passes) : [...rows];

  const sorts = (config.sorts ?? []).flatMap((sort) => {
    const property = properties.get(sort.propertyId);
    return property ? [{ propertyId: sort.propertyId, sign: sort.direction === "desc" ? -1 : 1, ranks: optionRanks(property) }] : [];
  });
  if (sorts.length === 0) return visible;

  return visible.sort((left, right) => {
    for (const sort of sorts) {
      const a = cellOf(left, sort.propertyId).value;
      const b = cellOf(right, sort.propertyId).value;
      if (isBlank(a) || isBlank(b)) {
        if (isBlank(a) !== isBlank(b)) return isBlank(a) ? 1 : -1;
        continue;
      }
      const order = sort.ranks ? (sort.ranks.get(a) ?? 0) - (sort.ranks.get(b) ?? 0) : compareNonNull(a, b);
      if (order !== 0) return order * sort.sign;
    }
    return 0;
  });
};

const NO_VALUE_KEY = "__none";
const NO_VALUE_LABEL = "No value";

export const groupRows = (input: {
  schema: DatabaseSchema;
  rows: DatabaseRow[];
  cells: ComputedRowValues;
  propertyId: string;
}): DatabaseRowGroup[] => {
  const { schema, rows, cells, propertyId } = input;
  const property = schema.properties.find((candidate) => candidate.id === propertyId);

  if (property?.type === "select" || property?.type === "status" || property?.type === "multi_select") {
    const groups = (property.options ?? []).map((option): DatabaseRowGroup => ({
      key: option.id,
      label: option.name,
      color: option.color,
      optionId: option.id,
      rows: [],
    }));
    const byOption = new Map(groups.map((group) => [group.key, group]));
    const none: DatabaseRowGroup = { key: NO_VALUE_KEY, label: NO_VALUE_LABEL, optionId: null, rows: [] };
    for (const row of rows) {
      const selected = selectedOptions(property, row.properties[property.id]);
      const unique = property.type === "multi_select" ? [...new Set(selected)] : selected.slice(0, 1);
      if (unique.length === 0) none.rows.push(row);
      for (const option of unique) byOption.get(option.id)?.rows.push(row);
    }
    return none.rows.length > 0 ? [...groups, none] : groups;
  }

  if (property?.type === "checkbox") {
    const isChecked = (row: DatabaseRow) => cells.get(row.id)?.[property.id]?.value === true;
    return [
      { key: "checked", label: "Checked", optionId: null, rows: rows.filter(isChecked) },
      { key: "unchecked", label: "Unchecked", optionId: null, rows: rows.filter((row) => !isChecked(row)) },
    ];
  }

  const groups = new Map<string, DatabaseRowGroup>();
  for (const row of rows) {
    const display = cells.get(row.id)?.[propertyId]?.display ?? "";
    const key = display === "" ? NO_VALUE_KEY : display;
    let group = groups.get(key);
    if (!group) {
      group = { key, label: display === "" ? NO_VALUE_LABEL : display, optionId: null, rows: [] };
      groups.set(key, group);
    }
    group.rows.push(row);
  }
  return [...groups.values()];
};

export type NestedRow = { row: DatabaseRow; depth: number; childCount: number };

/**
 * Sub-items: puts each row under the first parent it names that is also shown, keeping the given order.
 * A row whose parent is filtered out shows at the top level. Rows that are each other's parents
 * (a loop) are broken up rather than lost: every row appears exactly once.
 */
export const nestRows = (input: {
  rows: DatabaseRow[];
  parentPropertyId: string;
  /** Rows whose sub-items are shown. Rows not in it keep their sub-items hidden. */
  expanded: ReadonlySet<string>;
}): NestedRow[] => {
  const { rows, parentPropertyId, expanded } = input;
  const shown = new Set(rows.map((row) => row.id));
  const parentOf = new Map<string, string>();
  for (const row of rows) {
    const parent = storedStrings(row.properties[parentPropertyId]).find((id) => id !== row.id && shown.has(id));
    if (parent) parentOf.set(row.id, parent);
  }
  const children = new Map<string, DatabaseRow[]>();
  for (const row of rows) {
    const parent = parentOf.get(row.id);
    if (parent) children.set(parent, [...(children.get(parent) ?? []), row]);
  }

  const out: NestedRow[] = [];
  const placed = new Set<string>();
  const visit = (row: DatabaseRow, depth: number, visible: boolean) => {
    if (placed.has(row.id)) return;
    placed.add(row.id);
    const kids = (children.get(row.id) ?? []).filter((child) => !placed.has(child.id));
    if (visible) out.push({ row, depth, childCount: kids.length });
    for (const child of kids) visit(child, depth + 1, visible && expanded.has(row.id));
  };
  for (const row of rows) if (!parentOf.has(row.id)) visit(row, 0, true);
  // Whatever is left sits in a loop of parents: start each loop at its first row.
  for (const row of rows) if (!placed.has(row.id)) visit(row, 0, true);
  return out;
};
