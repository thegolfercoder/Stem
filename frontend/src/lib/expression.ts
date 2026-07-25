/**
 * A small, safe compiler for the infix expressions the backend emits.
 *
 * The server sends each model as a template with its parameter names intact —
 * `a*exp(b*x) + c` — which is compiled once here into a plain JavaScript
 * closure. Moving a slider then re-evaluates that closure a few hundred times
 * to redraw the curve, with no network round-trip and no re-parsing, which is
 * what keeps live editing at frame rate.
 *
 * `eval` and `new Function` are deliberately not used. The expression text
 * originates from our own backend, but compiling remote strings into
 * executable code is the kind of shortcut that stops being safe the moment
 * anything upstream changes. A parser costs one file and closes the question.
 */

/** Functions the backend's printer can emit, mapped to their implementations. */
const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  // SymPy spells natural log `log` and absolute value `Abs`.
  log: Math.log,
  ln: Math.log,
  log10: Math.log10,
  log2: Math.log2,
  exp: Math.exp,
  sqrt: Math.sqrt,
  Abs: Math.abs,
  abs: Math.abs,
  sign: Math.sign,
  floor: Math.floor,
  ceiling: Math.ceil,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  Max: Math.max,
  Min: Math.min,
};

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  E: Math.E,
};

type Token =
  | { kind: "number"; value: number }
  | { kind: "name"; value: string }
  | { kind: "op"; value: string }
  | { kind: "punct"; value: "(" | ")" | "," };

export class ExpressionError extends Error {}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index]!;

    if (char === " " || char === "\t" || char === "\n") {
      index += 1;
      continue;
    }

    if (char >= "0" && char <= "9") {
      const start = index;
      while (index < source.length && /[0-9.]/.test(source[index]!)) index += 1;
      // Scientific notation: the `e` only belongs to the number when a digit
      // or sign follows it, otherwise it is the constant E or an identifier.
      if (
        (source[index] === "e" || source[index] === "E") &&
        /[0-9+-]/.test(source[index + 1] ?? "")
      ) {
        index += 2;
        while (index < source.length && /[0-9]/.test(source[index]!)) index += 1;
      }
      const text = source.slice(start, index);
      const value = Number(text);
      if (!Number.isFinite(value)) {
        throw new ExpressionError(`Invalid number "${text}"`);
      }
      tokens.push({ kind: "number", value });
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      const start = index;
      while (index < source.length && /[A-Za-z0-9_]/.test(source[index]!)) index += 1;
      tokens.push({ kind: "name", value: source.slice(start, index) });
      continue;
    }

    if (char === "(" || char === ")" || char === ",") {
      tokens.push({ kind: "punct", value: char });
      index += 1;
      continue;
    }

    if (source.startsWith("**", index)) {
      tokens.push({ kind: "op", value: "^" });
      index += 2;
      continue;
    }

    if ("+-*/^".includes(char)) {
      tokens.push({ kind: "op", value: char });
      index += 1;
      continue;
    }

    throw new ExpressionError(`Unexpected character "${char}"`);
  }

  return tokens;
}

type Node =
  | { kind: "const"; value: number }
  | { kind: "var"; name: string }
  | { kind: "unary"; operand: Node }
  | { kind: "binary"; op: string; left: Node; right: Node }
  | { kind: "call"; name: string; args: Node[] };

const BINARY_PRECEDENCE: Record<string, number> = {
  "+": 1,
  "-": 1,
  "*": 2,
  "/": 2,
  "^": 3,
};

/** Pratt parser: precedence climbing with right-associative exponentiation. */
class Parser {
  private position = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): Node {
    const node = this.parseExpression(0);
    if (this.position < this.tokens.length) {
      throw new ExpressionError("Unexpected trailing input");
    }
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.position];
  }

  private parseExpression(minimumPrecedence: number): Node {
    let left = this.parseUnary();

    for (;;) {
      const token = this.peek();
      if (!token || token.kind !== "op") break;

      const precedence = BINARY_PRECEDENCE[token.value];
      if (precedence === undefined || precedence < minimumPrecedence) break;

      this.position += 1;
      // `2^3^2` is 2^(3^2): exponentiation binds to the right, so the
      // right-hand side is parsed at the same precedence rather than one above.
      const nextMinimum = token.value === "^" ? precedence : precedence + 1;
      const right = this.parseExpression(nextMinimum);
      left = { kind: "binary", op: token.value, left, right };
    }

    return left;
  }

  private parseUnary(): Node {
    const token = this.peek();
    if (token?.kind === "op" && (token.value === "-" || token.value === "+")) {
      this.position += 1;
      const operand = this.parseUnary();
      return token.value === "-" ? { kind: "unary", operand } : operand;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Node {
    const token = this.peek();
    if (!token) throw new ExpressionError("Unexpected end of expression");

    if (token.kind === "number") {
      this.position += 1;
      return { kind: "const", value: token.value };
    }

    if (token.kind === "punct" && token.value === "(") {
      this.position += 1;
      const node = this.parseExpression(0);
      this.expect(")");
      return node;
    }

    if (token.kind === "name") {
      this.position += 1;
      const next = this.peek();
      if (next?.kind === "punct" && next.value === "(") {
        this.position += 1;
        const args: Node[] = [];
        const maybeClose = this.peek();
        const isEmptyCall = maybeClose?.kind === "punct" && maybeClose.value === ")";
        if (!isEmptyCall) {
          for (;;) {
            args.push(this.parseExpression(0));
            const separator = this.peek();
            if (separator?.kind === "punct" && separator.value === ",") {
              this.position += 1;
              continue;
            }
            break;
          }
        }
        this.expect(")");
        if (!(token.value in FUNCTIONS)) {
          throw new ExpressionError(`Unknown function "${token.value}"`);
        }
        return { kind: "call", name: token.value, args };
      }
      return { kind: "var", name: token.value };
    }

    throw new ExpressionError(`Unexpected token "${String(token.value)}"`);
  }

  private expect(value: string): void {
    const token = this.peek();
    if (!token || token.kind !== "punct" || token.value !== value) {
      throw new ExpressionError(`Expected "${value}"`);
    }
    this.position += 1;
  }
}

/** A compiled expression: variable scope in, number out. */
export type CompiledExpression = (scope: Record<string, number>) => number;

function build(node: Node): CompiledExpression {
  switch (node.kind) {
    case "const": {
      const { value } = node;
      return () => value;
    }
    case "var": {
      const { name } = node;
      const constant = CONSTANTS[name];
      if (constant !== undefined) return () => constant;
      return (scope) => scope[name] ?? Number.NaN;
    }
    case "unary": {
      const operand = build(node.operand);
      return (scope) => -operand(scope);
    }
    case "binary": {
      const left = build(node.left);
      const right = build(node.right);
      switch (node.op) {
        case "+":
          return (scope) => left(scope) + right(scope);
        case "-":
          return (scope) => left(scope) - right(scope);
        case "*":
          return (scope) => left(scope) * right(scope);
        case "/":
          return (scope) => left(scope) / right(scope);
        case "^":
          return (scope) => Math.pow(left(scope), right(scope));
        default:
          throw new ExpressionError(`Unknown operator "${node.op}"`);
      }
    }
    case "call": {
      const fn = FUNCTIONS[node.name]!;
      const args = node.args.map(build);
      // Specialise the common arities; the generic path allocates an array on
      // every call, which matters when redrawing a curve point by point.
      if (args.length === 1) {
        const only = args[0]!;
        return (scope) => fn(only(scope));
      }
      if (args.length === 2) {
        const first = args[0]!;
        const second = args[1]!;
        return (scope) => fn(first(scope), second(scope));
      }
      return (scope) => fn(...args.map((arg) => arg(scope)));
    }
  }
}

/**
 * Compile an infix expression into a reusable evaluator.
 *
 * @throws {ExpressionError} if the text is not a valid expression.
 */
export function compile(source: string): CompiledExpression {
  return build(new Parser(tokenize(source)).parse());
}

/**
 * Compile a model template into `f(x, params)`.
 *
 * The scope object is allocated once and mutated per call rather than rebuilt,
 * because this runs for every pixel column of every visible curve on every
 * frame.
 */
export function compileModel(
  template: string,
  parameterNames: readonly string[],
): (x: number, values: readonly number[]) => number {
  const evaluate = compile(template);
  const scope: Record<string, number> = { x: 0 };

  return (x, values) => {
    scope.x = x;
    for (let index = 0; index < parameterNames.length; index += 1) {
      scope[parameterNames[index]!] = values[index] ?? Number.NaN;
    }
    return evaluate(scope);
  };
}
