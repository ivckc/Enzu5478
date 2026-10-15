import type { Module, Result } from "../core/types";
import { nextIdFor, readJsonArray, saveJsonArray } from "../core/storage";
import { splitFirst, toId } from "../core/parse";
import { problem, say } from "../core/result";

type Habit = {
  id: number;
  userId: string;
  title: string;
  note: string;
  days: string[]; // days it was done, YYYY-MM-DD (your computer's date)
  created: string; // YYYY-MM-DD
};

const HABITS_FILE = "habits.json";
const habits: Habit[] = [];

function ymd(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function today(): string {
  return ymd(new Date(Date.now()));
}

function shift(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

// streak = days in a row up to today (or up to yesterday if today is not done yet)
function stats(h: Habit): { streak: number; best: number; rate: number } {
  const set = new Set(h.days);
  const t = today();
  let cur = set.has(t) ? t : shift(t, -1);
  let streak = 0;
  while (set.has(cur)) {
    streak = streak + 1;
    cur = shift(cur, -1);
  }
  let best = 0;
  let run = 0;
  let prev = "";
  for (const d of [...set].sort()) {
    run = prev !== "" && shift(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  const age = Math.round((new Date(`${t}T00:00:00`).getTime() - new Date(`${h.created}T00:00:00`).getTime()) / 864e5) + 1;
  const window = Math.max(1, Math.min(30, age));
  let done = 0;
  for (let i = 0; i < window; i++) {
    if (set.has(shift(t, -i))) {
      done = done + 1;
    }
  }
  return { streak, best, rate: Math.round((100 * done) / window) };
}

function isHabit(x: unknown): x is Habit {
  if (typeof x !== "object" || x === null) {
    return false;
  }
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "number" && typeof o.userId === "string" && typeof o.title === "string" &&
    typeof o.note === "string" && Array.isArray(o.days) && o.days.every((d) => typeof d === "string") &&
    typeof o.created === "string"
  );
}

function save(): boolean {
  return saveJsonArray(HABITS_FILE, habits);
}

// "" / today / yesterday / YYYY-MM-DD (not in the future)
function parseDay(text: string): string | Result {
  const t = today();
  if (text === "" || text === "today") {
    return t;
  }
  if (text === "yesterday") {
    return shift(t, -1);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (m === null) {
    return problem("Use a day like today, yesterday or 2026-10-09.");
  }
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) {
    return problem("That date does not exist.");
  }
  if (text > t) {
    return problem("A habit cannot be marked for a day that has not come yet.");
  }
  return text;
}

function failed(action: string, detail: string): Result {
  return { ok: false, lines: ["Could not save the change. Nothing was changed."], logs: [{ action, detail, ok: false }] };
}

function setDay(rest: string, value: boolean): Result {
  const word = value ? "check" : "uncheck";
  const { first, others } = splitFirst(rest);
  const id = toId(first);
  if (id === null) {
    return problem(`Use: habit ${word} <number> [today | yesterday | YYYY-MM-DD]`);
  }
  const habit = habits.find((h) => h.id === id);
  if (habit === undefined) {
    return problem(`There is no habit ${id}.`);
  }
  const day = parseDay(others);
  if (typeof day !== "string") {
    return day;
  }
  const has = habit.days.includes(day);
  if (has === value) {
    return say(value ? `Habit ${id} is already marked for ${day}.` : `Habit ${id} was not marked for ${day}.`);
  }
  const old = habit.days.slice();
  habit.days = value ? [...habit.days, day].sort() : habit.days.filter((d) => d !== day);
  const detail = `#${id} ${habit.title} ${day}`;
  const action = value ? "habit.check" : "habit.uncheck";
  if (save()) {
    const s = stats(habit);
    return {
      ok: true,
      lines: [`${value ? "Marked" : "Unmarked"} habit ${id} for ${day}: ${habit.title} (streak ${s.streak})`],
      logs: [{ action, detail, ok: true }],
    };
  }
  habit.days = old;
  return failed(action, detail);
}

function textEdit(rest: string, field: "title" | "note"): Result {
  const { first, others } = splitFirst(rest);
  const id = toId(first);
  if (id === null || (field === "title" && others === "")) {
    return problem(`Use: habit ${field === "title" ? "rename" : "note"} <number> <text>`);
  }
  const habit = habits.find((h) => h.id === id);
  if (habit === undefined) {
    return problem(`There is no habit ${id}.`);
  }
  const old = habit[field];
  habit[field] = others;
  const detail = `#${id} ${field}: ${others}`;
  const action = field === "title" ? "habit.rename" : "habit.note";
  if (save()) {
    return { ok: true, lines: [`Habit ${id} ${field}: ${others === "" ? "(empty)" : others}`], logs: [{ action, detail, ok: true }] };
  }
  habit[field] = old;
  return failed(action, detail);
}

export const habitsModule: Module = {
  name: "habits",
  init: () => {
    const loaded = readJsonArray<unknown>(HABITS_FILE);
    if (loaded === null || !loaded.every(isHabit)) {
      return ["habits.json is damaged.", "I stopped so I do not overwrite it.", "Fix it or rename it, then run me again."];
    }
    for (const h of loaded) {
      habits.push(h);
    }
    return [];
  },
  snapshot: () => habits,
  commands: [
    {
      name: "habit add",
      usage: "habit add <title>",
      about: "add a habit",
      run: (rest) => {
        if (rest === "") {
          return problem("Use: habit add <title>");
        }
        const habit: Habit = { id: nextIdFor(habits), userId: "local", title: rest, note: "", days: [], created: today() };
        habits.push(habit);
        const detail = `#${habit.id} ${rest}`;
        if (save()) {
          return { ok: true, lines: [`Added habit ${habit.id}: ${rest}`], logs: [{ action: "habit.add", detail, ok: true }] };
        }
        habits.pop();
        return failed("habit.add", detail);
      },
    },
    { name: "habit check", usage: "habit check <n> [day]", about: "mark a habit done", run: (rest) => setDay(rest, true) },
    { name: "habit uncheck", usage: "habit uncheck <n> [day]", about: "unmark a day", run: (rest) => setDay(rest, false) },
    { name: "habit rename", usage: "habit rename <n> <title>", about: "change a habit title", run: (rest) => textEdit(rest, "title") },
    { name: "habit note", usage: "habit note <n> <text>", about: "write a short note", run: (rest) => textEdit(rest, "note") },
    {
      name: "habit delete",
      usage: "habit delete <n>",
      about: "delete a habit (asks first)",
      run: (rest) => {
        const id = toId(rest);
        const habit = habits.find((h) => h.id === id);
        if (id === null || habit === undefined) {
          return problem(id === null ? "Use: habit delete <number>" : `There is no habit ${id}.`);
        }
        return {
          ok: true,
          lines: [`Delete habit ${id}: ${habit.title}? All its days will be lost. Type yes to confirm.`],
          confirm: () => {
            const index = habits.indexOf(habit);
            habits.splice(index, 1);
            const detail = `#${id} ${habit.title}`;
            if (save()) {
              return { ok: true, lines: [`Deleted habit ${id}: ${habit.title}`], logs: [{ action: "habit.delete", detail, ok: true }] };
            }
            habits.splice(index, 0, habit);
            return failed("habit.delete", detail);
          },
        };
      },
    },
    {
      name: "habits",
      usage: "habits",
      about: "show habits and streaks",
      run: () => {
        if (habits.length === 0) {
          return say("No habits yet. Type habit add <title>.");
        }
        const t = today();
        return say(
          ...habits.map((h) => {
            const s = stats(h);
            return `${h.id}. [${h.days.includes(t) ? "x" : " "}] ${h.title}  (streak ${s.streak}, best ${s.best}, ${s.rate}%)`;
          })
        );
      },
    },
  ],
};

// Exports for tool adapters
export { habits, save };
