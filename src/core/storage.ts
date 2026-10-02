import * as fs from "node:fs";

export function readJsonArray<T>(file: string): T[] | null {
  if (!fs.existsSync(file)) {
    return [];
  }
  try {
    const data: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(data) ? (data as T[]) : null;
  } catch {
    return null;
  }
}

// Writes the file, reads it back, and checks it matches.
export function saveJsonArray<T>(file: string, items: T[]): boolean {
  try {
    fs.writeFileSync(file, JSON.stringify(items, null, 2), "utf8");
    const back = readJsonArray<T>(file);
    return back !== null && JSON.stringify(back) === JSON.stringify(items);
  } catch {
    return false;
  }
}

export function nextIdFor(items: { id: number }[]): number {
  let next = 1;
  for (const item of items) {
    if (item.id >= next) {
      next = item.id + 1;
    }
  }
  return next;
}
