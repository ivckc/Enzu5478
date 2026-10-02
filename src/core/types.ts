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

// What the core gives to every command.
export type Context = {
  // Ask the user to type "yes" before running the action.
  confirm: (action: () => void) => void;
};

// One command, for example "add" or "rename task".
export type Command = {
  name: string; // what the user types
  usage: string; // shown in help
  about: string; // shown in help
  run: (rest: string, ctx: Context) => void;
};

// A module is a group of commands that belong together.
export type Module = {
  name: string;
  commands: Command[];
};
