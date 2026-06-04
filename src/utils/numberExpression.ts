const isDigit = (char: string) => char >= "0" && char <= "9";

class NumberExpressionParser {
  private index = 0;

  constructor(private readonly input: string) {}

  parse() {
    const value = this.parseExpression();
    this.skipWhitespace();
    if (this.index !== this.input.length) {
      return null;
    }
    return Number.isFinite(value) ? value : null;
  }

  private parseExpression(): number {
    let value = this.parseTerm();
    while (true) {
      this.skipWhitespace();
      const operator = this.peek();
      if (operator !== "+" && operator !== "-") {
        return value;
      }
      this.index += 1;
      const next = this.parseTerm();
      value = operator === "+" ? value + next : value - next;
    }
  }

  private parseTerm(): number {
    let value = this.parseFactor();
    while (true) {
      this.skipWhitespace();
      const operator = this.peek();
      if (operator !== "*" && operator !== "/") {
        return value;
      }
      this.index += 1;
      const next = this.parseFactor();
      value = operator === "*" ? value * next : value / next;
    }
  }

  private parseFactor(): number {
    this.skipWhitespace();
    const operator = this.peek();
    if (operator === "+" || operator === "-") {
      this.index += 1;
      const value = this.parseFactor();
      return operator === "-" ? -value : value;
    }
    if (operator === "(") {
      this.index += 1;
      const value = this.parseExpression();
      this.skipWhitespace();
      if (this.peek() !== ")") {
        throw new Error("Missing closing parenthesis.");
      }
      this.index += 1;
      return value;
    }
    return this.parseNumber();
  }

  private parseNumber(): number {
    this.skipWhitespace();
    const start = this.index;
    while (isDigit(this.peek())) {
      this.index += 1;
    }
    if (this.peek() === ".") {
      this.index += 1;
      while (isDigit(this.peek())) {
        this.index += 1;
      }
    }
    if (start === this.index || this.input.slice(start, this.index) === ".") {
      throw new Error("Expected number.");
    }
    return Number(this.input.slice(start, this.index));
  }

  private peek() {
    return this.input[this.index] ?? "";
  }

  private skipWhitespace() {
    while (/\s/.test(this.peek())) {
      this.index += 1;
    }
  }
}

export const evaluateNumberExpression = (value: string) => {
  const normalized = value.replace(/,/g, ".").replace(/%/g, "").trim();
  if (!normalized) {
    return null;
  }

  try {
    return new NumberExpressionParser(normalized).parse();
  } catch {
    return null;
  }
};

