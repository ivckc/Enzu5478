import * as fs from "node:fs";
import type { Goal, Module, Result, Task } from "../core/types";
import { GOALS_FILE, TASKS_FILE, goals, replaceData, tasks } from "../core/data";
import { readJsonArray, saveJsonArray } from "../core/storage";
import { toId } from "../core/parse";
import { problem, say } from "../core/result";

const BACKUP_DIR = "backups";

function timestamp(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

// If a folder with this name exists, add -2, -3, ... so nothing is overwritten.
function uniqueName(base: string): string {
  let name = base;
  let n = 2;
  while (fs.existsSync(`${BACKUP_DIR}/${name}`)) {
    name = `${base}-${n}`;
    n = n + 1;
  }
  return name;
}

function removeFolder(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // nothing else to do
  }
}

// Saves the given data as a new backup folder.
// Returns the folder name, or null if it failed (the half-made folder is removed).
function writeBackup(prefix: string, taskList: Task[], goalList: Goal[]): string | null {
  const name = uniqueName(prefix + timestamp());
  const dir = `${BACKUP_DIR}/${name}`;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const ok =
      saveJsonArray(`${dir}/tasks.json`, taskList) &&
      saveJsonArray(`${dir}/goals.json`, goalList);
    if (ok) {
      return name;
    }
  } catch {
    // fall through
  }
  removeFolder(dir);
  return null;
}

function sortKey(name: string): string {
  return name.replace("before-restore_", "");
}

function listBackups(): string[] {
  if (!fs.existsSync(BACKUP_DIR)) {
    return [];
  }
  let names: string[];
  try {
    names = fs.readdirSync(BACKUP_DIR);
  } catch {
    return [];
  }
  return names
    .filter(
      (n) =>
        fs.existsSync(`${BACKUP_DIR}/${n}/tasks.json`) &&
        fs.existsSync(`${BACKUP_DIR}/${n}/goals.json`)
    )
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}

function describeBackup(name: string): string {
  const t = readJsonArray<Task>(`${BACKUP_DIR}/${name}/tasks.json`);
  const g = readJsonArray<Goal>(`${BACKUP_DIR}/${name}/goals.json`);
  if (t === null || g === null) {
    return "damaged";
  }
  return `${t.length} task(s), ${g.length} goal(s)`;
}

function doRestore(name: string, newTasks: Task[], newGoals: Goal[]): Result {
  // 1. Save a copy of the current data first.
  const oldTasks = tasks.map((t) => ({ ...t }));
  const oldGoals = goals.map((g) => ({ ...g }));
  const safety = writeBackup("before-restore_", oldTasks, oldGoals);
  if (safety === null) {
    return {
      ok: false,
      lines: [
        "Could not save a safety copy of your current data.",
        "Nothing was restored.",
      ],
      logs: [{ action: "backup.restore", detail: `${name}; no safety copy`, ok: false }],
    };
  }
  // 2. Write the backup over the live files.
  const ok = saveJsonArray(TASKS_FILE, newTasks) && saveJsonArray(GOALS_FILE, newGoals);
  if (!ok) {
    const back = saveJsonArray(TASKS_FILE, oldTasks) && saveJsonArray(GOALS_FILE, oldGoals);
    if (back) {
      return {
        ok: false,
        lines: ["Could not restore. I put your previous data back."],
        logs: [{ action: "backup.restore", detail: `${name}; rolled back`, ok: false }],
      };
    }
    return {
      ok: false,
      lines: [
        "Could not restore, and could not put your previous data back.",
        `Your previous data is safe in ${BACKUP_DIR}/${safety}.`,
        "Copy its two files over tasks.json and goals.json.",
      ],
      logs: [
        {
          action: "backup.restore",
          detail: `${name}; rollback failed; previous data in ${safety}`,
          ok: false,
        },
      ],
    };
  }
  // 3. Update memory.
  replaceData(newTasks, newGoals);
  return {
    ok: true,
    lines: [
      `Restored backup ${name}.`,
      `A copy of your previous data is in ${BACKUP_DIR}/${safety}.`,
    ],
    logs: [
      { action: "backup.restore", detail: `${name}; previous data saved as ${safety}`, ok: true },
    ],
  };
}

export const backupModule: Module = {
  name: "backup",
  snapshot: () => listBackups().map((name) => ({ name, info: describeBackup(name) })),
  commands: [
    {
      name: "backup",
      usage: "backup",
      about: "save a copy of your data",
      run: () => {
        const name = writeBackup("", tasks, goals);
        if (name === null) {
          return {
            ok: false,
            lines: ["Could not save the backup. Nothing was changed."],
            logs: [{ action: "backup.create", detail: "could not save", ok: false }],
          };
        }
        return {
          ok: true,
          lines: [
            `Backup saved: ${BACKUP_DIR}/${name} (${tasks.length} task(s), ${goals.length} goal(s))`,
          ],
          logs: [{ action: "backup.create", detail: name, ok: true }],
        };
      },
    },
    {
      name: "backups",
      usage: "backups",
      about: "show saved backups",
      run: () => {
        const names = listBackups();
        if (names.length === 0) {
          return say("No backups yet. Type backup to make one.");
        }
        const lines = ["Backups (oldest first):"];
        names.forEach((name, i) => {
          lines.push(`${i + 1}. ${name}  (${describeBackup(name)})`);
        });
        return say(...lines);
      },
    },
    {
      name: "restore",
      usage: "restore <n or name>",
      about: "bring back a backup (asks first)",
      run: (rest) => {
        if (rest === "") {
          return problem("Use: restore <number or name>. Type backups to see them.");
        }
        const names = listBackups();
        const id = toId(rest);
        const byNumber = id !== null && id >= 1 && id <= names.length ? names[id - 1] : undefined;
        const name = byNumber ?? names.find((n) => n === rest);
        if (name === undefined) {
          return problem(`There is no backup "${rest}". Type backups to see them.`);
        }
        const dir = `${BACKUP_DIR}/${name}`;
        const t = readJsonArray<Task>(`${dir}/tasks.json`);
        const g = readJsonArray<Goal>(`${dir}/goals.json`);
        if (t === null || g === null) {
          return problem("This backup is damaged. Nothing was restored.");
        }
        return {
          ok: true,
          lines: [
            `Restore backup ${name} (${t.length} task(s), ${g.length} goal(s))?`,
            "Your current data will be replaced. I will save a copy of it first.",
            "Type yes to confirm.",
          ],
          confirm: () => doRestore(name, t, g),
        };
      },
    },
  ],
};
