import type { Goal, Task } from "./types";
import { readJsonArray, saveJsonArray } from "./storage";

export const TASKS_FILE = "tasks.json";
export const GOALS_FILE = "goals.json";

export const tasks: Task[] = [];
export const goals: Goal[] = [];

const LEVELS: string[] = ["urgent", "medium", "normal"];

// Old files do not have the newer fields: give them default values.
function fixTask(t: Task): void {
  t.goalId = t.goalId ?? null;
  t.priority = LEVELS.includes(t.priority) ? t.priority : "normal";
  t.due = typeof t.due === "string" ? t.due : null;
  t.dueTime = typeof t.dueTime === "string" ? t.dueTime : null;
  t.subtasks = Array.isArray(t.subtasks) ? t.subtasks : [];
}

export function loadData(): void {
  const loadedTasks = readJsonArray<Task>(TASKS_FILE);
  const loadedGoals = readJsonArray<Goal>(GOALS_FILE);
  if (loadedTasks === null || loadedGoals === null) {
    console.log("One of the data files is damaged (tasks.json or goals.json).");
    console.log("I stopped so I do not overwrite it.");
    console.log("Fix it or rename it, then run me again.");
    process.exit(3);
  }
  for (const task of loadedTasks) {
    fixTask(task);
    tasks.push(task);
  }
  for (const goal of loadedGoals) {
    goals.push(goal);
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
