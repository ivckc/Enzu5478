import type { Goal, Task } from "./types";
import { readJsonArray, saveJsonArray } from "./storage";
import { DataDamaged, perUserArray } from "./userctx";

export const TASKS_FILE = "tasks.json";
export const GOALS_FILE = "goals.json";

const LEVELS: string[] = ["urgent", "medium", "normal"];

// Old files do not have the newer fields: give them default values.
function fixTask(t: Task): void {
  t.goalId = t.goalId ?? null;
  t.priority = LEVELS.includes(t.priority) ? t.priority : "normal";
  t.due = typeof t.due === "string" ? t.due : null;
  t.dueTime = typeof t.dueTime === "string" ? t.dueTime : null;
  t.subtasks = Array.isArray(t.subtasks) ? t.subtasks : [];
}

function loadList<T>(file: string): T[] {
  const loaded = readJsonArray<T>(file);
  if (loaded === null) {
    throw new DataDamaged([
      `${file} is damaged.`,
      "I stopped so I do not overwrite it.",
      "Fix it or rename it, then run me again.",
    ]);
  }
  return loaded;
}

// These look like normal lists, but each user has a different one
// (loaded from that user's own files the first time they are needed).
export const tasks: Task[] = perUserArray<Task>(() => {
  const list = loadList<Task>(TASKS_FILE);
  for (const task of list) {
    fixTask(task);
  }
  return list;
});
export const goals: Goal[] = perUserArray<Goal>(() => loadList<Goal>(GOALS_FILE));

// Start-up check for the owner's (terminal) data. Other users load when they first use Anzu.
export function loadData(): void {
  try {
    void tasks.length;
    void goals.length;
  } catch (e) {
    console.log("One of the data files is damaged (tasks.json or goals.json).");
    console.log("I stopped so I do not overwrite it.");
    console.log("Fix it or rename it, then run me again.");
    if (!(e instanceof DataDamaged)) {
      console.log(e instanceof Error ? e.message : String(e));
    }
    process.exit(3);
  }
}

export function saveTasks(): boolean {
  return saveJsonArray(TASKS_FILE, tasks);
}

export function saveGoals(): boolean {
  return saveJsonArray(GOALS_FILE, goals);
}

// Replaces what is in memory (used after restoring a backup).
export function replaceData(newTasks: Task[], newGoals: Goal[]): void {
  for (const task of newTasks) {
    fixTask(task);
  }
  tasks.splice(0, tasks.length, ...newTasks);
  goals.splice(0, goals.length, ...newGoals);
}
