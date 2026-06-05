export const normalizeCharacterSet = (input: unknown) => {
  const source = typeof input === "string" ? input : "";
  const glyphs = Array.from(source.replace(/\n/g, "").replace(/\t/g, " "));
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

export const reverseCharacterSet = (input: unknown) =>
  Array.from(typeof input === "string" ? input : "").reverse().join("");
