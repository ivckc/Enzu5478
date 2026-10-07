import type { Goal, Task } from "./types";
import { readJsonArray, saveJsonArray } from "./storage";

export const TASKS_FILE = "tasks.json";
export const GOALS_FILE = "goals.json";

export const tasks: Task[] = [];
export const goals: Goal[] = [];

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
    task.goalId = task.goalId ?? null;
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
    task.goalId = task.goalId ?? null;
  }
  tasks.splice(0, tasks.length, ...newTasks);
  goals.splice(0, goals.length, ...newGoals);
}
