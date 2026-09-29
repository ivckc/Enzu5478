import * as readline from "node:readline";
import * as fs from "node:fs";

type Task = {
  id: number;
  userId: string;
  title: string;
  done: boolean;
  goalId: number | null;
};

type Goal = {
  id: number;
  userId: string;
  title: string;
};

const TASKS_FILE = "tasks.json";
const GOALS_FILE = "goals.json";

function readJsonArray<T>(file: string): T[] | null {
  if (!fs.existsSync(file)) {
    return [];
  }
  try {
    const data: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(data) ? (data as T[]) : null;
  } catch {
    return null;
  }
}

function saveJsonArray<T>(file: string, items: T[]): boolean {
  try {
    fs.writeFileSync(file, JSON.stringify(items, null, 2), "utf8");
    const back = readJsonArray<T>(file);
    return back !== null && JSON.stringify(back) === JSON.stringify(items);
  } catch {
    return false;
  }
}

function nextIdFor(items: { id: number }[]): number {
  let next = 1;
  for (const item of items) {
    if (item.id >= next) {
      next = item.id + 1;
    }
  }
  return next;
}

const loadedTasks = readJsonArray<Task>(TASKS_FILE);
const loadedGoals = readJsonArray<Goal>(GOALS_FILE);
if (loadedTasks === null || loadedGoals === null) {
  console.log("One of the data files is damaged (tasks.json or goals.json).");
  console.log("I stopped so I do not overwrite it.");
  console.log("Fix it or rename it, then run me again.");
  process.exit(1);
}

const tasks: Task[] = loadedTasks;
const goals: Goal[] = loadedGoals;

for (const task of tasks) {
  task.goalId = task.goalId ?? null;
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function setDone(idText: string, value: boolean): void {
  const word = value ? "done" : "reopen";
  const id = Number(idText);
  if (idText === "" || !Number.isInteger(id)) {
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
  if (saveJsonArray(TASKS_FILE, tasks)) {
    console.log(
      value ? `Marked task ${id} as done: ${task.title}` : `Reopened task ${id}: ${task.title}`
    );
  } else {
    task.done = !value;
    console.log("Could not save the change. Nothing was changed.");
  }
}

function handleCommand(text: string): void {
  const space = text.indexOf(" ");
  const command = space === -1 ? text : text.slice(0, space);
  const rest = space === -1 ? "" : text.slice(space + 1).trim();

  if (command === "") {
    return;
  }

  if (command === "help") {
    console.log("Commands:");
    console.log("  add <task>            add a new task");
    console.log("  list                  show all tasks");
    console.log("  goal <goal>           add a new goal");
    console.log("  goals                 show all goals");
    console.log("  link <task> <goal>    link a task to a goal (use numbers)");
    console.log("  done <task>           mark a task as done (use its number)");
    console.log("  reopen <task>         mark a task as not done");
    console.log("  exit                  close the program");
    return;
  }

  if (command === "add") {
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
    if (saveJsonArray(TASKS_FILE, tasks)) {
      console.log(`Added and saved task ${task.id}: ${rest}`);
    } else {
      tasks.pop();
      console.log("Could not save the task. Nothing was added.");
    }
    return;
  }

  if (command === "list") {
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
    return;
  }

  if (command === "goal") {
    if (rest === "") {
      console.log("Write the goal after goal. Example: goal Learn programming");
      return;
    }
    const goal: Goal = { id: nextIdFor(goals), userId: "local", title: rest };
    goals.push(goal);
    if (saveJsonArray(GOALS_FILE, goals)) {
      console.log(`Added and saved goal ${goal.id}: ${rest}`);
    } else {
      goals.pop();
      console.log("Could not save the goal. Nothing was added.");
    }
    return;
  }

  if (command === "goals") {
    if (goals.length === 0) {
      console.log("No goals yet.");
      return;
    }
    for (const goal of goals) {
      const goalTasks = tasks.filter((t) => t.goalId === goal.id);
      const doneCount = goalTasks.filter((t) => t.done).length;
      console.log(
        `${goal.id}. ${goal.title}: ${doneCount} of ${goalTasks.length} task(s) done`
      );
    }
    return;
  }

  if (command === "link") {
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
    if (saveJsonArray(TASKS_FILE, tasks)) {
      console.log(`Linked task ${task.id} to goal ${goal.id}: ${goal.title}`);
    } else {
      task.goalId = oldGoalId;
      console.log("Could not save the link. Nothing was changed.");
    }
    return;
  }

  if (command === "done") {
    setDone(rest, true);
    return;
  }

  if (command === "reopen") {
    setDone(rest, false);
    return;
  }

  console.log(`I did not understand "${command}". Type help.`);
}

rl.setPrompt("anzu> ");
console.log(
  `Anzu is ready. I have ${tasks.length} task(s) and ${goals.length} goal(s). Type help.`
);
rl.prompt();

rl.on("line", (line: string) => {
  const text = line.trim();
  if (text === "exit") {
    console.log("Bye.");
    rl.close();
    return;
  }
  handleCommand(text);
  rl.prompt();
});