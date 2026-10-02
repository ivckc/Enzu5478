import type { Module, Result, Task } from "../core/types";
import { goals, saveTasks, tasks } from "../core/data";
import { nextIdFor } from "../core/storage";
import { splitFirst, toId } from "../core/parse";
import { problem, say } from "../core/result";

function setDone(idText: string, value: boolean): Result {
  const word = value ? "done" : "reopen";
  const id = toId(idText);
  if (id === null) {
    return problem(`Use: ${word} <task number>. Example: ${word} 1`);
  }
  const task = tasks.find((t) => t.id === id);
  if (task === undefined) {
    return problem(`There is no task ${id}.`);
  }
  if (task.done === value) {
    return say(value ? `Task ${id} is already done.` : `Task ${id} is not done yet.`);
  }
  task.done = value;
  const action = value ? "task.done" : "task.reopen";
  const detail = `#${id} ${task.title}`;
  if (saveTasks()) {
    const line = value
      ? `Marked task ${id} as done: ${task.title}`
      : `Reopened task ${id}: ${task.title}`;
    return { ok: true, lines: [line], logs: [{ action, detail, ok: true }] };
  }
  task.done = !value;
  return {
    ok: false,
    lines: ["Could not save the change. Nothing was changed."],
    logs: [{ action, detail, ok: false }],
  };
}

function deleteTask(task: Task): Result {
  const index = tasks.indexOf(task);
  const detail = `#${task.id} ${task.title}`;
  tasks.splice(index, 1);
  if (saveTasks()) {
    return {
      ok: true,
      lines: [`Deleted task ${task.id}: ${task.title}`],
      logs: [{ action: "task.delete", detail, ok: true }],
    };
  }
  tasks.splice(index, 0, task);
  return {
    ok: false,
    lines: ["Could not save. Nothing was deleted."],
    logs: [{ action: "task.delete", detail, ok: false }],
  };
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
          return problem("Write the task after add. Example: add Buy bread");
        }
        const task: Task = {
          id: nextIdFor(tasks),
          userId: "local",
          title: rest,
          done: false,
          goalId: null,
        };
        tasks.push(task);
        const detail = `#${task.id} ${rest}`;
        if (saveTasks()) {
          return {
            ok: true,
            lines: [`Added and saved task ${task.id}: ${rest}`],
            logs: [{ action: "task.add", detail, ok: true }],
          };
        }
        tasks.pop();
        return {
          ok: false,
          lines: ["Could not save the task. Nothing was added."],
          logs: [{ action: "task.add", detail, ok: false }],
        };
      },
    },
    {
      name: "list",
      usage: "list",
      about: "show all tasks",
      run: () => {
        if (tasks.length === 0) {
          return say("No tasks yet.");
        }
        const lines: string[] = [];
        for (const task of tasks) {
          const goal = goals.find((g) => g.id === task.goalId);
          const suffix = goal === undefined ? "" : `  [goal: ${goal.title}]`;
          const mark = task.done ? "[x]" : "[ ]";
          lines.push(`${task.id}. ${mark} ${task.title}${suffix}`);
        }
        return say(...lines);
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
          return problem("Use: link <task number> <goal number>. Example: link 1 1");
        }
        const task = tasks.find((t) => t.id === taskId);
        const goal = goals.find((g) => g.id === goalId);
        if (task === undefined) {
          return problem(`There is no task ${taskId}.`);
        }
        if (goal === undefined) {
          return problem(`There is no goal ${goalId}.`);
        }
        const oldGoalId = task.goalId;
        task.goalId = goal.id;
        const detail = `#${task.id} ${task.title} -> goal #${goal.id}`;
        if (saveTasks()) {
          return {
            ok: true,
            lines: [`Linked task ${task.id} to goal ${goal.id}: ${goal.title}`],
            logs: [{ action: "task.link", detail, ok: true }],
          };
        }
        task.goalId = oldGoalId;
        return {
          ok: false,
          lines: ["Could not save the link. Nothing was changed."],
          logs: [{ action: "task.link", detail, ok: false }],
        };
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
          return problem("Use: rename task <number> <new title>");
        }
        const task = tasks.find((t) => t.id === id);
        if (task === undefined) {
          return problem(`There is no task ${id}.`);
        }
        const oldTitle = task.title;
        task.title = others;
        const detail = `#${id} ${oldTitle} -> ${others}`;
        if (saveTasks()) {
          return {
            ok: true,
            lines: [`Renamed task ${id}: ${oldTitle} -> ${others}`],
            logs: [{ action: "task.rename", detail, ok: true }],
          };
        }
        task.title = oldTitle;
        return {
          ok: false,
          lines: ["Could not save the new title. Nothing was changed."],
          logs: [{ action: "task.rename", detail, ok: false }],
        };
      },
    },
    {
      name: "delete task",
      usage: "delete task <n>",
      about: "delete a task (asks first)",
      run: (rest) => {
        const id = toId(rest);
        if (id === null) {
          return problem("Use: delete task <number>");
        }
        const task = tasks.find((t) => t.id === id);
        if (task === undefined) {
          return problem(`There is no task ${id}.`);
        }
        return {
          ok: true,
          lines: [`Delete task ${task.id}: ${task.title}? Type yes to confirm.`],
          confirm: () => deleteTask(task),
        };
      },
    },
  ],
};
