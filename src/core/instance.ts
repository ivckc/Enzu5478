import * as crypto from "node:crypto";
import * as fs from "node:fs";

// Only one Anzu may run at a time. Two copies would write over each other's data.
// The running copy "touches" anzu.lock every few seconds. A lock that was not touched
// for a while belongs to a copy that is gone (closed window, restart, crash).

const LOCK_FILE = "anzu.lock";
const HEARTBEAT_MS = 5_000;
const STALE_AFTER_MS = 20_000;

type LockInfo = { token: string; pid: number; startedAt: string };

let myToken: string | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;

function tryCreate(info: LockInfo): boolean {
  try {
    // "wx" = create the file, but fail if it already exists. Two copies cannot both win.
    fs.writeFileSync(LOCK_FILE, JSON.stringify(info), { encoding: "utf8", flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

function lockAgeMs(): number | null {
  try {
    return Date.now() - fs.statSync(LOCK_FILE).mtimeMs;
  } catch {
    return null;
  }
}

function readLock(): LockInfo | null {
  try {
    const data: unknown = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));
    if (typeof data !== "object" || data === null) {
      return null;
    }
    const o = data as Record<string, unknown>;
    if (typeof o.token === "string" && typeof o.pid === "number" && typeof o.startedAt === "string") {
      return { token: o.token, pid: o.pid, startedAt: o.startedAt };
    }
    return null;
  } catch {
    return null;
  }
}

function release(): void {
  if (heartbeat !== null) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
  if (myToken === null) {
    return;
  }
  // Remove the lock only if it is still ours.
  const current = readLock();
  if (current !== null && current.token === myToken) {
    try {
      fs.unlinkSync(LOCK_FILE);
    } catch {
      // nothing else to do
    }
  }
  myToken = null;
}

function localTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function acquireInstance(): { ok: true } | { ok: false; lines: string[] } {
  const info: LockInfo = {
    token: crypto.randomBytes(8).toString("hex"),
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };

  let created = tryCreate(info);
  if (!created) {
    const age = lockAgeMs();
    if (age === null) {
      created = tryCreate(info); // the file disappeared just now
    } else if (age > STALE_AFTER_MS) {
      try {
        fs.unlinkSync(LOCK_FILE); // nobody has touched it: its owner is gone
      } catch {
        // someone else may have removed it already
      }
      created = tryCreate(info);
    }
  }

  if (!created) {
    const other = readLock();
    const since = other === null ? "" : ` (started ${localTime(other.startedAt)})`;
    return {
      ok: false,
      lines: [
        `Anzu is already running${since}.`,
        "Please use that window. If you closed it a moment ago, wait 20 seconds and try again.",
      ],
    };
  }

  myToken = info.token;

  // "I am still here": touch the file every few seconds.
  heartbeat = setInterval(() => {
    const now = new Date();
    try {
      fs.utimesSync(LOCK_FILE, now, now);
    } catch {
      tryCreate(info); // the file was removed: put it back
    }
  }, HEARTBEAT_MS);
  // This timer alone must not keep the program alive.
  (heartbeat as unknown as { unref?: () => void }).unref?.();

  process.on("exit", release);
  // Closing the window or stopping Anzu from outside: give the lock back first.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
    process.on(signal, () => {
      release();
      process.exit(0);
    });
  }
  return { ok: true };
}
