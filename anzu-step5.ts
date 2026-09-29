import * as readline from "node:readline";
import * as fs from "node:fs";

type Task = {
  id: number;
  userId: string;
  title: string;
  done: boolean;
};

const FILE = "tasks.json";

function readTasksFile(): Task[] | null {
  if (!fs.existsSync(FILE)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8")) as Task[];
  } catch {
    return null;
  }
}

const loaded = readTasksFile();
if (loaded === null) {
  console.log(`The file ${FILE} is damaged.`);
  console.log("I stopped so I do not overwrite it.");
  console.log("Fix it or rename it, then run me again.");
  process.exit(1);
}

const tasks: Task[] = loaded;

let nextId = 1;
for (const task of tasks) {
  if (task.id >= nextId) {
    nextId = task.id + 1;
  }
}

function saveTasks(): boolean {
  try {
    fs.writeFileSync(FILE, JSON.stringify(tasks, null, 2), "utf8");
    const back = readTasksFile();
    return back !== null && JSON.stringify(back) === JSON.stringify(tasks);
  } catch {
    return false;
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function handleCommand(text: string): void {
  const space = text.indexOf(" ");
  const command = space === -1 ? text : text.slice(0, space);
  const rest = space === -1 ? "" : text.slice(space + 1).trim();

  if (command === "") {
    return;
  }

  if (command === "help") {
    console.log("Commands:");
    console.log("  add <task>   add a new task");
    console.log("  list         show all tasks");
    console.log("  exit         close the program");
    return;
  }

  if (command === "add") {
    if (rest === "") {
      console.log("Write the task after add. Example: add Buy bread");
      return;
    }
    const task: Task = { id: nextId, userId: "local", title: rest, done: false };
    tasks.push(task);
    if (saveTasks()) {
      console.log(`Added and saved task ${task.id}: ${rest}`);
      nextId = nextId + 1;
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
      console.log(`${task.id}. ${task.title}`);
    }
    return;
  }

  console.log(`I did not understand "${command}". Type help.`);
}

rl.setPrompt("anzu> ");
console.log(`Anzu is ready. I have ${tasks.length} saved task(s). Type help.`);
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