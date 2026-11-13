import { AsyncLocalStorage } from "node:async_hooks";
import * as fs from "node:fs";
import * as path from "node:path";

// WHO is using Anzu right now?
//
// Every request from the web page (and every background job) runs "as" one user.
// All the data files, the activity log and the in-memory lists look at this to decide
// WHOSE data they touch. The owner (you) and the terminal use the old files in the
// project folder ("local"). Every other account gets its own folder: data/users/<id>/.

export const LOCAL = "local";

type Scope = { userId: string };
const scope = new AsyncLocalStorage<Scope>();

// Set by the cloud layer, which knows the account list (the SQLite database).
type Directory = { ownerId: () => string | null; allIds: () => string[] };
let directory: Directory = { ownerId: () => null, allIds: () => [] };
let ownerCache: string | null = null;

export function setDirectory(d: Directory): void {
  directory = d;
  ownerCache = null;
}

function ownerId(): string | null {
  if (ownerCache === null) {
    ownerCache = directory.ownerId();
  }
  return ownerCache;
}

// A damaged data file. The text is shown to the user; the file is never overwritten.
export class DataDamaged extends Error {
  lines: string[];
  constructor(lines: string[]) {
    super(lines.join(" "));
    this.lines = lines;
  }
}

export function damagedLines(e: unknown): string[] {
  return e instanceof DataDamaged ? e.lines : [e instanceof Error ? e.message : String(e)];
}

// The account id -> the id used for the files. The owner's account is "local".
export function canon(userId: string | null | undefined): string {
  if (userId === null || userId === undefined || userId === "" || userId === LOCAL) {
    return LOCAL;
  }
  if (!/^[A-Za-z0-9-]{8,64}$/.test(userId)) {
    throw new Error("bad user id");
  }
  return userId === ownerId() ? LOCAL : userId;
}

export function currentUser(): string {
  return scope.getStore()?.userId ?? LOCAL;
}

// Runs fn as this user. Works across await too (promises keep the user).
export function runAs<T>(userId: string | null | undefined, fn: () => T): T {
  return scope.run({ userId: canon(userId) }, fn);
}

export function isOwner(userId: string | null | undefined): boolean {
  return canon(userId) === LOCAL;
}

// Every user that has an account (plus the owner/terminal), without duplicates.
export function allUsers(): string[] {
  const out = new Set<string>([LOCAL]);
  for (const id of directory.allIds()) {
    try {
      out.add(canon(id));
    } catch {
      // a bad id in the list: skip it
    }
  }
  return Array.from(out);
}

// Where a data file lives for the current user.
export function userFile(file: string): string {
  const id = currentUser();
  if (id === LOCAL) {
    return file;
  }
  const dir = path.join(process.env.ANZU_DATA_DIR || "data", "users", id);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, file);
}

// One value per user, created the first time that user needs it.
// If create() throws (for example a damaged file), nothing is stored and nothing is overwritten.
export function perUser<T>(create: () => T): () => T {
  const all = new Map<string, T>();
  return () => {
    const id = currentUser();
    let value = all.get(id);
    if (value === undefined) {
      value = create();
      all.set(id, value);
    }
    return value;
  };
}

// A list that looks like one normal array to the rest of the code,
// but is really a different array for each user.
export function perUserArray<T>(create: () => T[]): T[] {
  const cur = perUser<T[]>(create);
  return new Proxy<T[]>([], {
    get: (_t, p) => Reflect.get(cur(), p),
    set: (_t, p, v) => Reflect.set(cur(), p, v),
    has: (_t, p) => Reflect.has(cur(), p),
    deleteProperty: (_t, p) => Reflect.deleteProperty(cur(), p),
    ownKeys: () => Reflect.ownKeys(cur()),
    getOwnPropertyDescriptor: (_t, p) => Reflect.getOwnPropertyDescriptor(cur(), p),
    defineProperty: (_t, p, d) => Reflect.defineProperty(cur(), p, d),
  });
}

// Same idea for a settings object.
export function perUserObject<T extends object>(create: () => T): T {
  const cur = perUser<T>(create);
  return new Proxy({} as T, {
    get: (_t, p) => Reflect.get(cur(), p),
    set: (_t, p, v) => Reflect.set(cur(), p, v),
    has: (_t, p) => Reflect.has(cur(), p),
    deleteProperty: (_t, p) => Reflect.deleteProperty(cur(), p),
    ownKeys: () => Reflect.ownKeys(cur()),
    getOwnPropertyDescriptor: (_t, p) => Reflect.getOwnPropertyDescriptor(cur(), p),
    defineProperty: (_t, p, d) => Reflect.defineProperty(cur(), p, d),
  });
}
