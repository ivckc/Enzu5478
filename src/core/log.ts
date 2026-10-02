import * as fs from "node:fs";

export const LOG_FILE = "activity.jsonl";

export type LogEntry = {
  time: string; // ISO time (UTC)
  actor: string;
  action: string;
  detail: string;
  ok: boolean;
};

// Adds one line at the end of the file. Never changes old lines.
export function appendLog(entry: LogEntry): boolean {
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n", "utf8");
    return true;
  } catch {
    return false;
  }
}

function isLogEntry(x: unknown): x is LogEntry {
  if (typeof x !== "object" || x === null) {
    return false;
  }
  const o = x as Record<string, unknown>;
  return (
    typeof o.time === "string" &&
    typeof o.actor === "string" &&
    typeof o.action === "string" &&
    typeof o.detail === "string" &&
    typeof o.ok === "boolean"
  );
}

// Returns null only if the file exists but cannot be read.
export function readLog(): { entries: LogEntry[]; unreadable: number } | null {
  if (!fs.existsSync(LOG_FILE)) {
    return { entries: [], unreadable: 0 };
  }
  let text: string;
  try {
    text = fs.readFileSync(LOG_FILE, "utf8");
  } catch {
    return null;
  }
  const entries: LogEntry[] = [];
  let unreadable = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    try {
      const data: unknown = JSON.parse(line);
      if (isLogEntry(data)) {
        entries.push(data);
      } else {
        unreadable = unreadable + 1;
      }
    } catch {
      unreadable = unreadable + 1;
    }
  }
  return { entries, unreadable };
}
