import * as readline from "node:readline";
import type { Command, Module, Result } from "./types";
import { appendLog } from "./log";

export function startApp(modules: Module[], greeting: () => string): void {
  const commands: Command[] = [];
  for (const mod of modules) {
    for (const command of mod.commands) {
      commands.push(command);
    }
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let pending: (() => Result) | null = null;

  // Shows a result, writes its log entries, and remembers a question if there is one.
  function show(result: Result): void {
    for (const line of result.lines) {
      console.log(line);
    }
    for (const info of result.logs ?? []) {
      const saved = appendLog({
        time: new Date().toISOString(),
        actor: info.actor ?? "user",
        action: info.action,
        detail: info.detail,
        ok: info.ok,
      });
      if (!saved) {
        console.log("Note: I could not write to the activity log.");
        break;
      }
    }
    if (result.confirm !== undefined) {
      pending = result.confirm;
    }
  }

  function showHelp(): void {
    console.log("Commands:");
    for (const command of commands) {
      console.log(`  ${command.usage.padEnd(26)}${command.about}`);
    }
    console.log(`  ${"exit".padEnd(26)}close the program`);
  }

  // The longest matching name wins: "rename task" beats "rename".
  function findCommand(text: string): Command | null {
    let best: Command | null = null;
    for (const command of commands) {
      const matches = text === command.name || text.startsWith(command.name + " ");
      if (matches && (best === null || command.name.length > best.name.length)) {
        best = command;
      }
    }
    return best;
  }

  function handle(text: string): void {
    if (text === "") {
      return;
    }
    const space = text.indexOf(" ");
    const word = space === -1 ? text : text.slice(0, space);
    if (word === "help") {
      showHelp();
      return;
    }
    const command = findCommand(text);
    if (command === null) {
      console.log(`I did not understand "${word}". Type help.`);
      return;
    }
    show(command.run(text.slice(command.name.length).trim()));
  }

  rl.setPrompt("anzu> ");
  console.log(greeting());
  rl.prompt();

  rl.on("line", (line: string) => {
    const text = line.trim();
    if (text === "exit") {
      console.log("Bye.");
      rl.close();
      return;
    }
    if (pending !== null) {
      const action = pending;
      pending = null;
      if (text === "yes") {
        show(action());
      } else {
        console.log("Cancelled. Nothing was changed.");
      }
      rl.prompt();
      return;
    }
    handle(text);
    rl.prompt();
  });
}
