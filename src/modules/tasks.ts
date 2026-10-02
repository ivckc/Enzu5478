import type { Module, Task } from "../core/types";
import { goals, saveTasks, tasks } from "../core/data";
import { nextIdFor } from "../core/storage";
import { splitFirst, toId } from "../core/parse";

function setDone(idText: string, value: boolean): void {
  const word = value ? "done" : "reopen";
  const id = toId(idText);
  if (id === null) {
    console.log(`Use: ${word} <task number>. Example: ${word} 1`);
    return;
  }
  const task = tasks.find((t) => t.id === id);
  if (task === undefined) {
    console.log(`There is no task ${id}.`);
    return;
  }
  if (task.done === value) {
    console.log(value ? `Task ${id} is already done.` : `Task ${id} is not done yet.`);
    return;
  }
  task.done = value;
  if (saveTasks()) {
    console.log(
      value ? `Marked task ${id} as done: ${task.title}` : `Reopened task ${id}: ${task.title}`
    );
  } else {
    task.done = !value;
    console.log("Could not save the change. Nothing was changed.");
  }
}

function deleteTask(task: Task): void {
  const index = tasks.indexOf(task);
  tasks.splice(index, 1);
  if (saveTasks()) {
    console.log(`Deleted task ${task.id}: ${task.title}`);
  } else {
    tasks.splice(index, 0, task);
    console.log("Could not save. Nothing was deleted.");
  }
}

export const tasksModule: Module = {
  name: "tasks",
  commands: [
    {
      name: "add",
      usage: "add <task>",
      about: "add a new task",
      run: (rest) => {
        if (rest === "") {
          console.log("Write the task after add. Example: add Buy bread");
          return;
        }
        const task: Task = {
          id: nextIdFor(tasks),
          userId: "local",
          title: rest,
          done: false,
          goalId: null,
        };
        tasks.push(task);
        if (saveTasks()) {
          console.log(`Added and saved task ${task.id}: ${rest}`);
        } else {
          tasks.pop();
          console.log("Could not save the task. Nothing was added.");
        }
      },
    },
    {
      name: "list",
      usage: "list",
      about: "show all tasks",
      run: () => {
        if (tasks.length === 0) {
          console.log("No tasks yet.");
          return;
        }
        for (const task of tasks) {
          const goal = goals.find((g) => g.id === task.goalId);
          const suffix = goal === undefined ? "" : `  [goal: ${goal.title}]`;
          const mark = task.done ? "[x]" : "[ ]";
          console.log(`${task.id}. ${mark} ${task.title}${suffix}`);
        }
      },
    },
    {
      name: "done",
      usage: "done <task>",
      about: "mark a task as done",
      run: (rest) => setDone(rest, true),
    },
    {
      name: "reopen",
      usage: "reopen <task>",
      about: "mark a task as not done",
      run: (rest) => setDone(rest, false),
    },
    {
      name: "link",
      usage: "link <task> <goal>",
      about: "link a task to a goal",
      run: (rest) => {
        const parts = rest.split(" ").filter((p) => p !== "");
        const taskId = Number(parts[0]);
        const goalId = Number(parts[1]);
        if (parts.length !== 2 || !Number.isInteger(taskId) || !Number.isInteger(goalId)) {
          console.log("Use: link <task number> <goal number>. Example: link 1 1");
          return;
        }
        const task = tasks.find((t) => t.id === taskId);
        const goal = goals.find((g) => g.id === goalId);
        if (task === undefined) {
          console.log(`There is no task ${taskId}.`);
          return;
        }
        if (goal === undefined) {
          console.log(`There is no goal ${goalId}.`);
          return;
        }
        const oldGoalId = task.goalId;
        task.goalId = goal.id;
        if (saveTasks()) {
          console.log(`Linked task ${task.id} to goal ${goal.id}: ${goal.title}`);
        } else {
          task.goalId = oldGoalId;
          console.log("Could not save the link. Nothing was changed.");
        }
      },
    },
    {
      name: "rename task",
      usage: "rename task <n> <title>",
      about: "change a task title",
      run: (rest) => {
        const { first, others } = splitFirst(rest);
        const id = toId(first);
        if (id === null || others === "") {
          console.log("Use: rename task <number> <new title>");
          return;
        }
        const task = tasks.find((t) => t.id === id);
        if (task === undefined) {
          console.log(`There is no task ${id}.`);
          return;
        }
        const oldTitle = task.title;
        task.title = others;
        if (saveTasks()) {
          console.log(`Renamed task ${id}: ${oldTitle} -> ${others}`);
        } else {
          task.title = oldTitle;
          console.log("Could not save the new title. Nothing was changed.");
        }
      },
    },
    {
      name: "delete task",
      usage: "delete task <n>",
      about: "delete a task (asks first)",
      run: (rest, ctx) => {
        const id = toId(rest);
        if (id === null) {
          console.log("Use: delete task <number>");
          return;
        }
        const task = tasks.find((t) => t.id === id);
        if (task === undefined) {
          console.log(`There is no task ${id}.`);
          return;
        }
        console.log(`Delete task ${task.id}: ${task.title}? Type yes to confirm.`);
        ctx.confirm(() => deleteTask(task));
      },
    },
  ],
};
