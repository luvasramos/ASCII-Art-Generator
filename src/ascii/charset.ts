export const normalizeCharacterSet = (input: string) => {
  const glyphs = Array.from(input.replace(/\n/g, "").replace(/\t/g, " "));
  const seen = new Set<string>();
  const unique = glyphs.filter((glyph) => {
    if (seen.has(glyph)) {
      return false;
    }
    seen.add(glyph);
    return true;
  });
  return unique.length ? unique.join("") : "@%#*+=-:. ";
};

export const reverseCharacterSet = (input: string) => Array.from(input).reverse().join("");
