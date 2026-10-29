export type Priority = "urgent" | "medium" | "normal";
export type Subtask = { id: number; title: string; done: boolean };

export type Task = {
  id: number;
  userId: string;
  title: string;
  done: boolean;
  goalId: number | null;
  priority: Priority;
  due: string | null; // YYYY-MM-DD
  dueTime: string | null; // HH:MM
  subtasks: Subtask[];
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

// A message that should also reach the user outside this window (for example, on the phone).
export type Notice = {
  title: string;
  message: string;
  priority?: 1 | 2 | 3 | 4 | 5; // 1 = lowest, 3 = normal, 5 = highest
  tags?: string[];
};

// What every command returns. The core decides how to show it.
export type Result = {
  ok: boolean;
  lines: string[]; // what to tell the user
  logs?: LogInfo[]; // what to write in the activity log
  notices?: Notice[]; // what to also send outside this window
  confirm?: () => Result; // if set: wait for "yes", then run this
  // For async commands (e.g., agent loop): once this Promise resolves,
  // its Result replaces this one (including any new confirm()).
  _async?: Promise<Result>;
};

// One command, for example "add" or "rename task".
// run() may return a Promise for async commands (e.g. the agent "ask" command).
export type Command = {
  name: string; // what the user types
  usage: string; // shown in help
  about: string; // shown in help
  run: (rest: string) => Result | Promise<Result>;
};

export type AsyncResult<T = any> = Result & {
  _async: Promise<T>;
};

// Something that runs by itself, again and again (for example: check reminders).
// Return null when there is nothing to tell the user.
export type Job = {
  name: string;
  everyMs: number;
  run: () => Result | null | Promise<Result | null>;
};

// A module is a group of commands that belong together.
export type Module = {
  name: string;
  commands: Command[];
  // Runs once at start. Return problems to stop the program (empty list = fine).
  init?: () => string[];
  // Things the module does by itself while the program is running.
  jobs?: Job[];
  // Called when any module says "tell the user this". Return a Result only if something went wrong.
  // What the web page may show about this module (never secrets).
  snapshot?: () => unknown;
  onNotice?: (notice: Notice) => Result | null;
};
