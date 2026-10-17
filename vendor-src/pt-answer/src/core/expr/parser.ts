/**
 * parser.ts — written for impulse, replacing mathjs in this copy.
 *
 * Reads a math expression into nodes shaped like mathjs's (ConstantNode,
 * SymbolNode, OperatorNode, ParenthesisNode, FunctionNode, RelationalNode,
 * ConditionalNode), which ast.ts's `convert` then turns into the plain AST
 * exactly as it did with mathjs. So everything after parsing — the student
 * checks, evaluation, TeX — is unchanged upstream code.
 *
 * It covers what an answer field needs and follows the precedence and
 * implicit-multiplication rules mathjs has (tested against mathjs itself,
 * see test/differential.mjs):
 *
 *   conditional  a ? b : c
 *   or, xor, and
 *   relational   == != < > <= >=   (two operands: an operator; more: a chain)
 *   + -          (a following "x%" adds/subtracts a percentage of the left side)
 *   * / % mod
 *   implicit *   2pi, 2(3), (1+2)(3+4), 2 sqrt(2), (1+2)3
 *   "rule 2"     number / number symbol → (number / number) symbol: 1/2pi = pi/2
 *   unary %      50% → 50/100
 *   unary        - + ~ not
 *   ^            right-associative, unary allowed in the exponent: 2^-3
 *   postfix      ! and '
 *   primary      numbers (1, 1.5, .5, 5., 1e-3, 0x1F), names, f(a, b),
 *                ( … ), [1, 2] and [1, 2; 3, 4], "text" / 'text',
 *                v[i], obj.name, true/false/null/undefined, NaN, Infinity
 *   assignment   x = 1, f(x) = …, and ";" separators: parsed into the nodes
 *                mathjs gives, which ast.ts then refuses ("not allowed")
 *
 * Not supported (a syntax error here, while mathjs would build a node that
 * ast.ts refuses anyway): objects {a: 1}, ranges 1:3, unit conversion
 * "to"/"in", bitwise & | << >>, "??" and optional chaining "?.". Radix
 * numbers keep to integers (0x1F, 0b101, 0o17).
 */

type TokenType = 'delim' | 'number' | 'symbol' | 'end';

interface Node {
  type: string;
  [key: string]: unknown;
}

const DELIMITERS = new Set([
  ',', '(', ')', '[', ']', '{', '}', '"', "'", ';', '+', '-', '*', '.*', '/', './', '%', '^', '.^', '~', '!', '&', '|',
  '^|', '=', ':', '?', '?.', '??', '==', '!=', '<', '>', '<=', '>=', '<<', '>>', '>>>',
]);
const NAMED_DELIMITERS = new Set(['mod', 'to', 'in', 'and', 'xor', 'or', 'not']);
const CONSTANTS: Record<string, unknown> = { true: true, false: false, null: null, undefined };

const isDigit = (c: string): boolean => c >= '0' && c <= '9';
const isDecimalMark = (c: string, next: string): boolean => c === '.' && next !== '/' && next !== '*' && next !== '^';
const isLatinOrGreek = (c: string): boolean => /^[a-zA-Z_$À-ʯͰ-Ͽ℀-⅏]$/.test(c);
// Mathematical alphanumeric symbols (𝑥, 𝔸 …) are surrogate pairs starting with U+D835.
const isMathSymbol = (high: string, low: string): boolean =>
  high === '\uD835' &&
  /^[\uDC00-\uDFFF]$/.test(low) &&
  !/^[\uDC55\uDC9D\uDCA0\uDCA1\uDCA3\uDCA4\uDCA7\uDCA8\uDCAD\uDCBA\uDCBC\uDCC4\uDD06\uDD0B\uDD0C\uDD15\uDD1D\uDD3A\uDD3F\uDD45\uDD47-\uDD49\uDD51\uDEA6\uDEA7\uDFCC\uDFCD]$/.test(low);

/**
 * A number token's value, as mathjs reads it: decimal through Number();
 * 0b/0o/0x with a radix point by place value; with a word size (0xFFi8) as a
 * signed integer of that many bits. Anything unreadable is a syntax error.
 */
function toNumber(token: string): number {
  const fraction = /(0[box])([0-9a-fA-F]*)\.([0-9a-fA-F]*)/.exec(token);
  if (fraction) {
    const base = { '0b': 2, '0o': 8, '0x': 16 }[fraction[1] as '0b' | '0o' | '0x'];
    let value = parseInt(fraction[2]!, base);
    [...fraction[3]!].forEach((d, i) => (value += parseInt(d, base) / base ** (i + 1)));
    if (Number.isNaN(value)) throw new SyntaxError(`String "${token}" is not a valid number`);
    return value;
  }
  const sized = /(0[box][0-9a-fA-F]*)i([0-9]*)/.exec(token);
  const text = sized ? sized[1]! : token;
  let value = Number(text);
  if (Number.isNaN(value)) throw new SyntaxError(`String "${text}" is not a valid number`);
  if (sized) {
    const bits = Number(sized[2]);
    if (value > 2 ** bits - 1) throw new SyntaxError(`String "${text}" is out of range`);
    if (value >= 2 ** (bits - 1)) value -= 2 ** bits;
  }
  return value;
}

const constant = (value: unknown): Node => ({ type: 'ConstantNode', value });
const operator = (op: string, fn: string, args: Node[], implicit = false, isPercentage = false): Node => ({
  type: 'OperatorNode',
  op,
  fn,
  args,
  implicit,
  isPercentage,
});
const isConstant = (n: Node): boolean => n.type === 'ConstantNode';
const isOperator = (n: Node): boolean => n.type === 'OperatorNode';
// mathjs "rule 2" applies after a number, or a signed number: 1/2x, -1/2x.
const rule2Start = (n: Node): boolean =>
  isConstant(n) ||
  (isOperator(n) && (n.args as Node[]).length === 1 && isConstant((n.args as Node[])[0]!) && '-+~'.includes(n.op as string));

class Parser {
  private index = 0;
  private token = '';
  private tokenType: TokenType = 'end';
  private nesting = 0;
  private conditionalLevel: number | null = null;

  constructor(private readonly src: string) {}

  parse(): Node {
    this.next();
    const node = this.block();
    if (this.tokenType !== 'end') {
      throw this.error(this.tokenType === 'delim' ? `Unexpected operator ${this.token}` : `Unexpected part "${this.token}"`);
    }
    return node;
  }

  // ── tokens ──

  // The current token, read fresh: TypeScript would otherwise keep a type
  // narrowed by an earlier check across next(), which changes it.
  private is(token: string): boolean {
    return this.token === token;
  }

  private isType(type: TokenType): boolean {
    return this.tokenType === type;
  }

  private char(offset = 0): string {
    return this.src.charAt(this.index + offset);
  }

  private error(message: string): SyntaxError {
    return new SyntaxError(`${message} (char ${this.index - this.token.length + 1})`);
  }

  private isAlpha(c: string, prev: string, next: string): boolean {
    return isLatinOrGreek(c) || isMathSymbol(c, next) || isMathSymbol(prev, c);
  }

  // The next token. A line break is whitespace inside brackets and a statement
  // separator outside them, except right after an operator (skipNewline).
  private next(skipNewline = false): void {
    do this.read();
    while (skipNewline && this.token === '\n');
  }

  private read(): void {
    this.token = '';
    // whitespace and # comments
    for (;;) {
      if (this.char() === '#') while (this.char() !== '' && this.char() !== '\n') this.index++;
      const c = this.char();
      if (c === ' ' || c === '\t' || c === ' ' || (c === '\n' && this.nesting > 0)) this.index++;
      else break;
    }
    const c = this.char();
    if (c === '') {
      this.tokenType = 'end';
      return;
    }
    if (c === '\n') return this.take('delim', 1);
    const c3 = this.src.substr(this.index, 3);
    const c2 = this.src.substr(this.index, 2);
    if (c3.length === 3 && DELIMITERS.has(c3)) return this.take('delim', 3);
    if (c2.length === 2 && DELIMITERS.has(c2) && (c2 !== '?.' || !isDigit(this.char(2)))) return this.take('delim', 2);
    if (DELIMITERS.has(c)) return this.take('delim', 1);

    if (isDigit(c) || c === '.') return this.number();

    if (this.isAlpha(c, this.char(-1), this.char(1))) {
      const start = this.index;
      while (this.isAlpha(this.char(), this.char(-1), this.char(1)) || isDigit(this.char())) this.index++;
      this.token = this.src.slice(start, this.index);
      this.tokenType = NAMED_DELIMITERS.has(this.token) ? 'delim' : 'symbol';
      return;
    }
    this.token = this.src.slice(this.index);
    this.index = this.src.length;
    throw this.error(`Syntax error in part "${this.token}"`);
  }

  private take(type: TokenType, length: number): void {
    this.tokenType = type;
    this.token = this.src.substr(this.index, length);
    this.index += length;
  }

  private number(): void {
    const start = this.index;
    this.tokenType = 'number';
    const radix = this.src.substr(this.index, 2);
    if (radix === '0b' || radix === '0o' || radix === '0x') {
      // 0x1F, 0b101, 0o17, 0x1.8, 0xFFi8 (signed, 8 bits): read here, checked in toNumber
      const word = (): void => {
        while (this.isAlpha(this.char(), this.char(-1), this.char(1)) || isDigit(this.char())) this.index++;
      };
      this.index += 2;
      word();
      if (this.char() === '.') {
        this.index++;
        word();
      }
      this.token = this.src.slice(start, this.index);
      return;
    }
    if (this.char() === '.') {
      this.index++;
      if (!isDigit(this.char())) {
        // just a dot (mathjs: dot notation), not a number
        this.tokenType = 'delim';
        this.token = '.';
        return;
      }
    } else {
      while (isDigit(this.char())) this.index++;
      if (isDecimalMark(this.char(), this.char(1))) this.index++;
    }
    while (isDigit(this.char())) this.index++;
    // exponent: 2.3e-4, 1e50, 2e+4; "2e" alone is 2 times e
    if (this.char() === 'e' || this.char() === 'E') {
      if (isDigit(this.char(1)) || this.char(1) === '-' || this.char(1) === '+') {
        this.index++;
        if (this.char() === '+' || this.char() === '-') this.index++;
        this.token = this.src.slice(start, this.index);
        if (!isDigit(this.char())) throw this.error(`Digit expected, got "${this.char()}"`);
        while (isDigit(this.char())) this.index++;
        this.token = this.src.slice(start, this.index);
        if (isDecimalMark(this.char(), this.char(1))) throw this.error(`Digit expected, got "${this.char()}"`);
      } else if (isDecimalMark(this.char(1), this.char(2))) {
        this.index++;
        this.token = this.src.slice(start, this.index);
        throw this.error(`Digit expected, got "${this.char()}"`);
      }
    }
    this.token = this.src.slice(start, this.index);
  }

  private save(): [number, string, TokenType, number, number | null] {
    return [this.index, this.token, this.tokenType, this.nesting, this.conditionalLevel];
  }

  private restore(s: [number, string, TokenType, number, number | null]): void {
    [this.index, this.token, this.tokenType, this.nesting, this.conditionalLevel] = s;
  }

  // ── grammar, loosest binding first ──

  // Statements separated by ";" or a line break: more than one makes a BlockNode
  // (refused later); nothing at all (e.g. only a # comment) is the constant undefined.
  private block(): Node {
    let node: Node | undefined;
    const blocks: Node[] = [];
    if (this.tokenType !== 'end' && this.token !== '\n' && this.token !== ';') node = this.assignment();
    while (this.token === '\n' || this.token === ';') {
      if (blocks.length === 0 && node) blocks.push(node);
      this.next();
      if (this.token !== '\n' && this.token !== ';' && this.tokenType !== 'end') {
        node = this.assignment();
        blocks.push(node);
      }
    }
    if (blocks.length > 0) return { type: 'BlockNode', blocks };
    return node ?? constant(undefined);
  }

  // "x = 1" and "f(x) = …" parse (and are then refused as not allowed); "2 = 1" is a syntax error
  private assignment(): Node {
    const node = this.conditional();
    if (this.token !== '=') return node;
    if (node.type === 'SymbolNode' || node.type === 'AccessorNode') {
      this.next(true);
      return { type: 'AssignmentNode', object: node, value: this.assignment() };
    }
    if (node.type === 'FunctionNode' && (node.fn as Node).type === 'SymbolNode') {
      const params = (node.args as Node[]).map((a) => {
        if (a.type !== 'SymbolNode') throw this.error('Invalid left hand side of assignment operator =');
        return a.name as string;
      });
      this.next(true);
      return { type: 'FunctionAssignmentNode', name: (node.fn as Node).name, params, expr: this.assignment() };
    }
    throw this.error('Invalid left hand side of assignment operator =');
  }

  private conditional(): Node {
    let node = this.logicalOr();
    while (this.token === '?') {
      const prev = this.conditionalLevel;
      this.conditionalLevel = this.nesting;
      this.next(true);
      const condition = node;
      const trueExpr = this.assignment();
      if (!this.is(':')) throw this.error('False part of conditional expression expected');
      this.conditionalLevel = null;
      this.next(true);
      const falseExpr = this.assignment();
      node = { type: 'ConditionalNode', condition, trueExpr, falseExpr };
      this.conditionalLevel = prev;
    }
    return node;
  }

  private binaryLoop(names: Record<string, string>, operand: () => Node): Node {
    let node = operand();
    while (Object.hasOwn(names, this.token)) {
      const name = this.token;
      this.next(true);
      node = operator(name, names[name]!, [node, operand()]);
    }
    return node;
  }

  private logicalOr(): Node {
    return this.binaryLoop({ or: 'or' }, () => this.logicalXor());
  }

  private logicalXor(): Node {
    return this.binaryLoop({ xor: 'xor' }, () => this.logicalAnd());
  }

  private logicalAnd(): Node {
    return this.binaryLoop({ and: 'and' }, () => this.relational());
  }

  private relational(): Node {
    const names: Record<string, string> = { '==': 'equal', '!=': 'unequal', '<': 'smaller', '>': 'larger', '<=': 'smallerEq', '>=': 'largerEq' };
    const params = [this.addSubtract()];
    const conditionals: { name: string; fn: string }[] = [];
    while (Object.hasOwn(names, this.token)) {
      conditionals.push({ name: this.token, fn: names[this.token]! });
      this.next(true);
      params.push(this.addSubtract());
    }
    if (params.length === 1) return params[0]!;
    if (params.length === 2) return operator(conditionals[0]!.name, conditionals[0]!.fn, params);
    return { type: 'RelationalNode', conditionals: conditionals.map((c) => c.fn), params };
  }

  private addSubtract(): Node {
    let node = this.multiplyDivide();
    const names: Record<string, string> = { '+': 'add', '-': 'subtract' };
    while (Object.hasOwn(names, this.token)) {
      const name = this.token;
      this.next(true);
      const right = this.multiplyDivide();
      // "a + b%" is a + a·b/100
      const args = right.isPercentage ? [node, operator('*', 'multiply', [node, right])] : [node, right];
      node = operator(name, names[name]!, args);
    }
    return node;
  }

  private multiplyDivide(): Node {
    let node = this.implicitMultiplication();
    const names: Record<string, string> = { '*': 'multiply', '.*': 'dotMultiply', '/': 'divide', './': 'dotDivide', '%': 'mod', mod: 'mod' };
    while (Object.hasOwn(names, this.token)) {
      const name = this.token;
      this.next(true);
      node = operator(name, names[name]!, [node, this.implicitMultiplication()]);
    }
    return node;
  }

  private implicitMultiplication(): Node {
    let node = this.rule2();
    let last = node;
    for (;;) {
      const symbol = this.tokenType === 'symbol';
      // a number only multiplies implicitly after something that isn't a number: (2+3)2, 3!2
      const number = this.tokenType === 'number' && !isConstant(last) && (!isOperator(last) || last.op === '!');
      if (!(symbol || number || this.token === '(')) break;
      last = this.rule2();
      node = operator('*', 'multiply', [node, last], true);
    }
    return node;
  }

  // "number / number symbol" binds as (number / number) symbol
  private rule2(): Node {
    let node = this.unaryPercentage();
    let last = node;
    while (this.token === '/' && rule2Start(last)) {
      const beforeSlash = this.save();
      this.next(true);
      if (this.tokenType !== 'number') {
        this.restore(beforeSlash);
        break;
      }
      const atNumber = this.save();
      this.next(true);
      if (this.isType('symbol') || this.is('(') || this.is('in')) {
        this.restore(atNumber);
        last = this.unaryPercentage();
        node = operator('/', 'divide', [node, last]);
      } else {
        this.restore(beforeSlash);
        break;
      }
    }
    return node;
  }

  // "50%" is 50/100; "50 % 3" stays the modulo operator
  private unaryPercentage(): Node {
    let node = this.unary();
    if (this.token === '%') {
      const before = this.save();
      this.next(true);
      try {
        this.unary();
        this.restore(before);
      } catch {
        node = operator('/', 'divide', [node, constant(100)], false, true);
      }
    }
    return node;
  }

  private unary(): Node {
    const names: Record<string, string> = { '-': 'unaryMinus', '+': 'unaryPlus', '~': 'bitNot', not: 'not' };
    if (Object.hasOwn(names, this.token)) {
      const name = this.token;
      this.next(true);
      return operator(name, names[name]!, [this.unary()]);
    }
    return this.pow();
  }

  private pow(): Node {
    const node = this.postfix();
    if (this.token === '^' || this.token === '.^') {
      const name = this.token;
      this.next(true);
      return operator(name, name === '^' ? 'pow' : 'dotPow', [node, this.unary()]);
    }
    return node;
  }

  private postfix(): Node {
    let node = this.primary();
    const names: Record<string, string> = { '!': 'factorial', "'": 'ctranspose' };
    while (Object.hasOwn(names, this.token)) {
      const name = this.token;
      this.next();
      node = this.accessors(operator(name, names[name]!, [node]));
    }
    return node;
  }

  private primary(): Node {
    if (this.tokenType === 'symbol' || (this.tokenType === 'delim' && NAMED_DELIMITERS.has(this.token))) {
      const name = this.token;
      this.next();
      let node: Node;
      if (Object.hasOwn(CONSTANTS, name)) node = constant(CONSTANTS[name]);
      else if (name === 'NaN' || name === 'Infinity') node = constant(Number(name));
      else node = { type: 'SymbolNode', name };
      return this.accessors(node);
    }
    if (this.token === '"' || this.token === "'") return this.accessors(constant(this.string(this.token)));
    if (this.token === '[') return this.accessors(this.matrix());
    if (this.tokenType === 'number') {
      // moves on before converting, as mathjs does: after "5%" a bad "0or" is skipped, making 5% a percentage
      const token = this.token;
      this.next();
      return constant(toNumber(token));
    }
    if (this.token === '(') {
      this.nesting++;
      this.next();
      const content = this.assignment();
      if (!this.is(')')) throw this.error('Parenthesis ) expected');
      this.nesting--;
      this.next();
      return this.accessors({ type: 'ParenthesisNode', content });
    }
    throw this.error(this.tokenType === 'end' ? 'Unexpected end of expression' : 'Value expected');
  }

  // "text" or 'text', with \" \' \\ \/ \b \f \n \r \t \uXXXX escapes; the opening quote is the current token
  private string(quote: string): string {
    const escapes: Record<string, string> = { '"': '"', "'": "'", '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
    let out = '';
    while (this.char() !== '' && this.char() !== quote) {
      if (this.char() === '\\') {
        this.index++;
        const c = this.char();
        if (Object.hasOwn(escapes, c)) {
          out += escapes[c];
          this.index++;
        } else if (c === 'u' && /^[0-9A-Fa-f]{4}$/.test(this.src.slice(this.index + 1, this.index + 5))) {
          out += String.fromCharCode(parseInt(this.src.slice(this.index + 1, this.index + 5), 16));
          this.index += 5;
        } else {
          throw this.error(c === 'u' ? 'Invalid unicode character' : `Bad escape character \\${c}`);
        }
      } else {
        out += this.char();
        this.index++;
      }
    }
    this.next();
    if (this.token !== quote) throw this.error(`End of string ${quote} expected`);
    this.next();
    return out;
  }

  // [1, 2] or [1, 2; 3, 4]
  private matrix(): Node {
    this.nesting++;
    this.next();
    if (this.token === ']') {
      this.nesting--;
      this.next();
      return { type: 'ArrayNode', items: [] };
    }
    const rows = [this.row()];
    if (this.token === ';') {
      while (this.token === ';') {
        this.next();
        if (!this.is(']')) rows.push(this.row());
      }
    }
    if (this.token !== ']') throw this.error('End of matrix ] expected');
    this.nesting--;
    this.next();
    if (rows.length === 1) return rows[0]!;
    const cols = (rows[0]!.items as Node[]).length;
    for (const r of rows) {
      if ((r.items as Node[]).length !== cols) throw this.error(`Column dimensions mismatch (${(r.items as Node[]).length} !== ${cols})`);
    }
    return { type: 'ArrayNode', items: rows };
  }

  private row(): Node {
    const items = [this.assignment()];
    while (this.token === ',') {
      this.next();
      if (!this.is(']') && !this.is(';')) items.push(this.assignment());
    }
    return { type: 'ArrayNode', items };
  }

  // f(a, b), v[i], obj.name. Only a name (or an accessor) can be called;
  // "(1+2)(3)" is left to implicit multiplication.
  private accessors(node: Node): Node {
    for (;;) {
      if (this.token === '(') {
        if (node.type !== 'SymbolNode' && node.type !== 'AccessorNode') return node;
        node = { type: 'FunctionNode', fn: node, args: this.list(')') };
      } else if (this.token === '[') {
        node = { type: 'AccessorNode', object: node, index: { type: 'IndexNode', dimensions: this.list(']'), dotNotation: false } };
      } else if (this.token === '.') {
        this.next();
        if (!(this.tokenType === 'symbol' || (this.tokenType === 'delim' && NAMED_DELIMITERS.has(this.token)))) {
          throw this.error('Property name expected after dot');
        }
        const name = constant(this.token);
        this.next();
        node = { type: 'AccessorNode', object: node, index: { type: 'IndexNode', dimensions: [name], dotNotation: true } };
      } else {
        return node;
      }
    }
  }

  // "( a, b )" or "[ a, b ]": the current token is the opening bracket
  private list(close: string): Node[] {
    this.nesting++;
    this.next();
    const items: Node[] = [];
    if (this.token !== close) {
      items.push(this.assignment());
      while (this.token === ',') {
        this.next();
        items.push(this.assignment());
      }
    }
    if (this.token !== close) throw this.error(`Parenthesis ${close} expected`);
    this.nesting--;
    this.next();
    return items;
  }
}

/** Parse `src` into mathjs-shaped nodes; throws SyntaxError "… (char N)" like mathjs. */
export function parseMathLike(src: string): Node {
  return new Parser(src).parse();
}
