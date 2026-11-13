import * as fs from "node:fs";
import { userFile } from "./userctx";

// All file names below are the names the modules use (tasks.json ...).
// userFile() turns them into the current user's own file.

function readArrayAt<T>(file: string): T[] | null {
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

function readObjectAt(file: string): Record<string, unknown> | null | undefined {
  if (!fs.existsSync(file)) {
    return undefined;
  }
  try {
    const data: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (typeof data === "object" && data !== null && !Array.isArray(data)) {
      return data as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export function readJsonArray<T>(file: string): T[] | null {
  return readArrayAt<T>(userFile(file));
}

// Writes the file, reads it back, and checks it matches.
export function saveJsonArray<T>(file: string, items: T[]): boolean {
  const path = userFile(file);
  try {
    fs.writeFileSync(path, JSON.stringify(items, null, 2), "utf8");
    const back = readArrayAt<T>(path);
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

// Reads a file that holds one JSON object (not a list).
// Returns undefined if the file does not exist, and null if it is damaged.
export function readJsonObject(file: string): Record<string, unknown> | null | undefined {
  return readObjectAt(userFile(file));
}

// Writes the object, reads it back, and checks it matches.
export function saveJsonObject(file: string, value: object): boolean {
  const path = userFile(file);
  try {
    fs.writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
    const back = readObjectAt(path);
    return back !== undefined && back !== null && JSON.stringify(back) === JSON.stringify(value);
  } catch {
    return false;
  }
}
