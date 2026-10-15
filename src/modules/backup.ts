import * as fs from "node:fs";
import type { Goal, Module, Result, Task } from "../core/types";
import { GOALS_FILE, TASKS_FILE, goals, replaceData, tasks } from "../core/data";
import { readJsonArray, readJsonObject, saveJsonArray, saveJsonObject } from "../core/storage";
import { toId } from "../core/parse";
import { problem, say } from "../core/result";

const BACKUP_DIR = "backups";

// All data files to back up
const DATA_FILES = [
  "tasks.json",
  "goals.json",
  "reminders.json",
  "habits.json",
  "notify.json",
];

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

// Saves all data files as a new backup folder.
// Returns the folder name, or null if it failed (the half-made folder is removed).
function writeBackup(prefix: string): string | null {
  const name = uniqueName(prefix + timestamp());
  const dir = `${BACKUP_DIR}/${name}`;
  try {
    fs.mkdirSync(dir, { recursive: true });
    let allOk = true;
    for (const file of DATA_FILES) {
      if (fs.existsSync(file)) {
        // Try reading as array first
        const arrayData = readJsonArray<unknown>(file);
        if (arrayData !== null) {
          if (!saveJsonArray(`${dir}/${file}`, arrayData)) {
            allOk = false;
            break;
          }
        } else {
          // Try as object
          const objData = readJsonObject(file);
          if (objData === null || objData === undefined) {
            allOk = false;
            break;
          }
          if (!saveJsonObject(`${dir}/${file}`, objData)) {
            allOk = false;
            break;
          }
        }
      }
    }
    if (allOk) {
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
    .filter((n) => {
      // A valid backup must have at least tasks.json and goals.json
      return (
        fs.existsSync(`${BACKUP_DIR}/${n}/tasks.json`) &&
        fs.existsSync(`${BACKUP_DIR}/${n}/goals.json`)
      );
    })
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}

function describeBackup(name: string): string {
  const dir = `${BACKUP_DIR}/${name}`;
  const counts: string[] = [];

  const t = readJsonArray<Task>(`${dir}/tasks.json`);
  const g = readJsonArray<Goal>(`${dir}/goals.json`);

  if (t === null || g === null) {
    return "damaged";
  }

  counts.push(`${t.length} task(s)`);
  counts.push(`${g.length} goal(s)`);

  // Check for other data files
  const r = readJsonArray<unknown>(`${dir}/reminders.json`);
  if (r !== null && r.length > 0) {
    counts.push(`${r.length} reminder(s)`);
  }

  const h = readJsonArray<unknown>(`${dir}/habits.json`);
  if (h !== null && h.length > 0) {
    counts.push(`${h.length} habit(s)`);
  }

  return counts.join(", ");
}

function doRestore(name: string): Result {
  const dir = `${BACKUP_DIR}/${name}`;

  // Read all files from the backup
  const backupArrays: Map<string, unknown[]> = new Map();
  const backupObjects: Map<string, Record<string, unknown>> = new Map();

  for (const file of DATA_FILES) {
    const arrayData = readJsonArray<unknown>(`${dir}/${file}`);
    if (arrayData !== null) {
      backupArrays.set(file, arrayData);
    } else {
      const objData = readJsonObject(`${dir}/${file}`);
      if (objData !== null && objData !== undefined) {
        backupObjects.set(file, objData);
      }
    }
  }

  // Must have at least tasks and goals
  if (!backupArrays.has("tasks.json") || !backupArrays.has("goals.json")) {
    return {
      ok: false,
      lines: ["This backup is damaged. Nothing was restored."],
      logs: [{ action: "backup.restore", detail: `${name}; damaged`, ok: false }],
    };
  }

  // 1. Save a copy of the current data first.
  const safety = writeBackup("before-restore_");
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
  const oldArrays: Map<string, unknown[]> = new Map();
  const oldObjects: Map<string, Record<string, unknown>> = new Map();
  let allOk = true;

  // Save current data in case we need to rollback
  for (const file of DATA_FILES) {
    if (fs.existsSync(file)) {
      const arrayData = readJsonArray<unknown>(file);
      if (arrayData !== null) {
        oldArrays.set(file, arrayData);
      } else {
        const objData = readJsonObject(file);
        if (objData !== null && objData !== undefined) {
          oldObjects.set(file, objData);
        }
      }
    }
  }

  // Write backup files (arrays)
  for (const [file, data] of backupArrays) {
    if (!saveJsonArray(file, data)) {
      allOk = false;
      break;
    }
  }

  // Write backup files (objects)
  if (allOk) {
    for (const [file, data] of backupObjects) {
      if (!saveJsonObject(file, data)) {
        allOk = false;
        break;
      }
    }
  }

  if (!allOk) {
    // Try to rollback
    let rollbackOk = true;
    for (const [file, data] of oldArrays) {
      if (!saveJsonArray(file, data)) {
        rollbackOk = false;
        break;
      }
    }
    if (rollbackOk) {
      for (const [file, data] of oldObjects) {
        if (!saveJsonObject(file, data)) {
          rollbackOk = false;
          break;
        }
      }
    }

    if (rollbackOk) {
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
        `Copy its files over your data files.`,
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

  // 3. Update memory for tasks and goals.
  const newTasks = backupArrays.get("tasks.json") as Task[];
  const newGoals = backupArrays.get("goals.json") as Goal[];
  replaceData(newTasks, newGoals);

  return {
    ok: true,
    lines: [
      `Restored backup ${name}.`,
      `A copy of your previous data is in ${BACKUP_DIR}/${safety}.`,
      "Restart Anzu for other modules (reminders, habits) to reload.",
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
        const name = writeBackup("");
        if (name === null) {
          return {
            ok: false,
            lines: ["Could not save the backup. Nothing was changed."],
            logs: [{ action: "backup.create", detail: "could not save", ok: false }],
          };
        }

        // Count what was backed up
        const counts: string[] = [];
        counts.push(`${tasks.length} task(s)`);
        counts.push(`${goals.length} goal(s)`);

        const remindersData = readJsonArray<unknown>("reminders.json");
        if (remindersData && remindersData.length > 0) {
          counts.push(`${remindersData.length} reminder(s)`);
        }

        const habitsData = readJsonArray<unknown>("habits.json");
        if (habitsData && habitsData.length > 0) {
          counts.push(`${habitsData.length} habit(s)`);
        }

        return {
          ok: true,
          lines: [
            `Backup saved: ${BACKUP_DIR}/${name}`,
            `Contains: ${counts.join(", ")}`,
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
        const description = describeBackup(name);
        if (description === "damaged") {
          return problem("This backup is damaged. Nothing was restored.");
        }
        return {
          ok: true,
          lines: [
            `Restore backup ${name} (${description})?`,
            "Your current data will be replaced. I will save a copy of it first.",
            "Type yes to confirm.",
          ],
          confirm: () => doRestore(name),
        };
      },
    },
  ],
};
