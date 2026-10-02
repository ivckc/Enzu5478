// "2 Call Ahmed" -> first = "2", others = "Call Ahmed"
export function splitFirst(text: string): { first: string; others: string } {
  const space = text.indexOf(" ");
  if (space === -1) {
    return { first: text, others: "" };
  }
  return { first: text.slice(0, space), others: text.slice(space + 1).trim() };
}

// "3" -> 3. Anything that is not a whole number -> null.
export function toId(text: string): number | null {
  if (text === "") {
    return null;
  }
  const n = Number(text);
  return Number.isInteger(n) ? n : null;
}
