import * as readline from "node:readline";

type Task = {
  id: number;
  userId: string;
  title: string;
  done: boolean;
};

const tasks: Task[] = [];
let nextId = 1;

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
    tasks.push({ id: nextId, userId: "local", title: rest, done: false });
    console.log(`Added task ${nextId}: ${rest}`);
    nextId = nextId + 1;
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
console.log("Anzu is ready. Type help to see the commands.");
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