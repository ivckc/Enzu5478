import type { Module, Priority, Result, Subtask, Task } from "../core/types";
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

const PRIORITIES: Record<string, Priority> = {
  urgent: "urgent", "عاجل": "urgent", medium: "medium", "متوسط": "medium", normal: "normal", "عادي": "normal",
};
const DUE_USAGE = "Use: due <task number> <today | tomorrow | YYYY-MM-DD | none> [HH:MM]";

function ymd(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// "tomorrow 18:00" -> { due: "2026-10-10", time: "18:00" }. A text means: a problem.
function parseDue(text: string): { due: string | null; time: string | null } | string {
  const parts = text.split(" ").filter((p) => p !== "");
  const key = parts[0] ?? "";
  if (["none", "clear", "بدون"].includes(key) && parts.length === 1) {
    return { due: null, time: null };
  }
  const now = new Date(Date.now());
  let date: string;
  if (key === "today") {
    date = ymd(now);
  } else if (key === "tomorrow") {
    date = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  } else {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    if (m === null) {
      return DUE_USAGE;
    }
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) {
      return "That date does not exist.";
    }
    date = key;
  }
  if (parts.length === 1) {
    return { due: date, time: null };
  }
  const t = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(parts[1] ?? "");
  if (parts.length !== 2 || t === null) {
    return "I did not understand the time. Use HH:MM, for example 18:00.";
  }
  return { due: date, time: `${t[1].padStart(2, "0")}:${t[2]}` };
}

// Shown after the title in "list", only when something is set.
function extras(t: Task): string {
  const bits: string[] = [];
  if (t.priority !== "normal") {
    bits.push(t.priority);
  }
  if (t.due !== null) {
    bits.push(`due ${t.due}${t.dueTime === null ? "" : " " + t.dueTime}`);
  }
  if (t.subtasks.length > 0) {
    bits.push(`subtasks ${t.subtasks.filter((x) => x.done).length}/${t.subtasks.length}`);
  }
  return bits.length === 0 ? "" : `  (${bits.join(", ")})`;
}

function failed(action: string, detail: string): Result {
  return { ok: false, lines: ["Could not save the change. Nothing was changed."], logs: [{ action, detail, ok: false }] };
}

function setSub(rest: string, value: boolean): Result {
  const word = value ? "done" : "reopen";
  const { first, others } = splitFirst(rest);
  const id = toId(first);
  const n = toId(others);
  if (id === null || n === null) {
    return problem(`Use: sub ${word} <task number> <subtask number>`);
  }
  const task = tasks.find((t) => t.id === id);
  if (task === undefined) {
    return problem(`There is no task ${id}.`);
  }
  const sub = task.subtasks.find((x) => x.id === n);
  if (sub === undefined) {
    return problem(`Task ${id} has no subtask ${n}.`);
  }
  if (sub.done === value) {
    return say(value ? `Subtask ${n} is already done.` : `Subtask ${n} is not done yet.`);
  }
  sub.done = value;
  const detail = `#${id}.${n} ${sub.title}`;
  const action = value ? "sub.done" : "sub.reopen";
  if (saveTasks()) {
    return {
      ok: true,
      lines: [value ? `Subtask ${n} done: ${sub.title}` : `Subtask ${n} reopened: ${sub.title}`],
      logs: [{ action, detail, ok: true }],
    };
  }
  sub.done = !value;
  return failed(action, detail);
}

function deleteSub(task: Task, sub: Subtask): Result {
  const index = task.subtasks.indexOf(sub);
  const detail = `#${task.id}.${sub.id} ${sub.title}`;
  task.subtasks.splice(index, 1);
  if (saveTasks()) {
    return { ok: true, lines: [`Deleted subtask ${sub.id}: ${sub.title}`], logs: [{ action: "sub.delete", detail, ok: true }] };
  }
  task.subtasks.splice(index, 0, sub);
  return failed("sub.delete", detail);
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
          priority: "normal",
          due: null,
          dueTime: null,
          subtasks: [],
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
          lines.push(`${task.id}. ${mark} ${task.title}${suffix}${extras(task)}`);
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
    {
      name: "priority",
      usage: "priority <task> <level>",
      about: "urgent | medium | normal",
      run: (rest) => {
        const { first, others } = splitFirst(rest);
        const id = toId(first);
        const level = PRIORITIES[others.toLowerCase()];
        if (id === null || level === undefined) {
          return problem("Use: priority <task number> <urgent | medium | normal>", "(Arabic works too: عاجل | متوسط | عادي)");
        }
        const task = tasks.find((t) => t.id === id);
        if (task === undefined) {
          return problem(`There is no task ${id}.`);
        }
        const old = task.priority;
        task.priority = level;
        const detail = `#${id} ${task.title} -> ${level}`;
        if (saveTasks()) {
          return { ok: true, lines: [`Task ${id} priority: ${level}`], logs: [{ action: "task.priority", detail, ok: true }] };
        }
        task.priority = old;
        return failed("task.priority", detail);
      },
    },
    {
      name: "due",
      usage: "due <task> <when>",
      about: "today | tomorrow | date [HH:MM]",
      run: (rest) => {
        const { first, others } = splitFirst(rest);
        const id = toId(first);
        if (id === null) {
          return problem(DUE_USAGE);
        }
        const parsed = parseDue(others);
        if (typeof parsed === "string") {
          return problem(parsed);
        }
        const task = tasks.find((t) => t.id === id);
        if (task === undefined) {
          return problem(`There is no task ${id}.`);
        }
        const oldDue = task.due;
        const oldTime = task.dueTime;
        task.due = parsed.due;
        task.dueTime = parsed.time;
        const text = parsed.due === null ? "no due date" : `due ${parsed.due}${parsed.time === null ? "" : " " + parsed.time}`;
        const detail = `#${id} ${task.title}: ${text}`;
        if (saveTasks()) {
          return { ok: true, lines: [`Task ${id}: ${text}`], logs: [{ action: "task.due", detail, ok: true }] };
        }
        task.due = oldDue;
        task.dueTime = oldTime;
        return failed("task.due", detail);
      },
    },
    {
      name: "sub add",
      usage: "sub add <task> <text>",
      about: "add a subtask",
      run: (rest) => {
        const { first, others } = splitFirst(rest);
        const id = toId(first);
        if (id === null || others === "") {
          return problem("Use: sub add <task number> <text>");
        }
        const task = tasks.find((t) => t.id === id);
        if (task === undefined) {
          return problem(`There is no task ${id}.`);
        }
        const sub: Subtask = { id: nextIdFor(task.subtasks), title: others, done: false };
        task.subtasks.push(sub);
        const detail = `#${id}.${sub.id} ${others}`;
        if (saveTasks()) {
          return { ok: true, lines: [`Added subtask ${sub.id} to task ${id}: ${others}`], logs: [{ action: "sub.add", detail, ok: true }] };
        }
        task.subtasks.pop();
        return failed("sub.add", detail);
      },
    },
    { name: "sub done", usage: "sub done <task> <n>", about: "finish a subtask", run: (rest) => setSub(rest, true) },
    { name: "sub reopen", usage: "sub reopen <task> <n>", about: "reopen a subtask", run: (rest) => setSub(rest, false) },
    {
      name: "sub delete",
      usage: "sub delete <task> <n>",
      about: "delete a subtask (asks first)",
      run: (rest) => {
        const { first, others } = splitFirst(rest);
        const id = toId(first);
        const n = toId(others);
        if (id === null || n === null) {
          return problem("Use: sub delete <task number> <subtask number>");
        }
        const task = tasks.find((t) => t.id === id);
        const sub = task?.subtasks.find((x) => x.id === n);
        if (task === undefined || sub === undefined) {
          return problem(`There is no subtask ${n} in task ${id}.`);
        }
        return { ok: true, lines: [`Delete subtask ${n}: ${sub.title}? Type yes to confirm.`], confirm: () => deleteSub(task, sub) };
      },
    },
  ],
};
