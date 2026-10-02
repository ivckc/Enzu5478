export type Task = {
  id: number;
  userId: string;
  title: string;
  done: boolean;
  goalId: number | null;
};

export type Goal = {
  id: number;
  userId: string;
  title: string;
};

// One entry for the activity log.
export type LogInfo = {
  action: string; // for example "task.add"
  detail: string; // what it was about
  ok: boolean; // did it work
  actor?: "user" | "anzu"; // who did it (default: user)
};

// What every command returns. The core decides how to show it.
export type Result = {
  ok: boolean;
  lines: string[]; // what to tell the user
  logs?: LogInfo[]; // what to write in the activity log
  confirm?: () => Result; // if set: wait for "yes", then run this
};

// One command, for example "add" or "rename task".
export type Command = {
  name: string; // what the user types
  usage: string; // shown in help
  about: string; // shown in help
  run: (rest: string) => Result;
};

// A module is a group of commands that belong together.
export type Module = {
  name: string;
  commands: Command[];
};
