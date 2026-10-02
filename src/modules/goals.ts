import type { Goal, LogInfo, Module, Result } from "../core/types";
import { goals, saveGoals, saveTasks, tasks } from "../core/data";
import { nextIdFor } from "../core/storage";
import { splitFirst, toId } from "../core/parse";
import { problem, say } from "../core/result";

function deleteGoal(goal: Goal): Result {
  const detail = `#${goal.id} ${goal.title}`;
  const linked = tasks.filter((t) => t.goalId === goal.id);
  for (const t of linked) {
    t.goalId = null;
  }
  if (linked.length > 0 && !saveTasks()) {
    for (const t of linked) {
      t.goalId = goal.id;
    }
    return {
      ok: false,
      lines: ["Could not save the tasks. Nothing was deleted."],
      logs: [{ action: "goal.delete", detail, ok: false }],
    };
  }
  const logs: LogInfo[] = [];
  if (linked.length > 0) {
    logs.push({
      action: "task.unlink",
      detail: `${linked.length} task(s) from goal #${goal.id}`,
      ok: true,
    });
  }
  const index = goals.indexOf(goal);
  goals.splice(index, 1);
  if (saveGoals()) {
    logs.push({ action: "goal.delete", detail, ok: true });
    return { ok: true, lines: [`Deleted goal ${goal.id}: ${goal.title}`], logs };
  }
  goals.splice(index, 0, goal);
  logs.push({ action: "goal.delete", detail, ok: false });
  return {
    ok: false,
    lines: [
      "The tasks were unlinked, but the goal could not be deleted.",
      "No task was lost. You can try again.",
    ],
    logs,
  };
}

export const goalsModule: Module = {
  name: "goals",
  commands: [
    {
      name: "goal",
      usage: "goal <goal>",
      about: "add a new goal",
      run: (rest) => {
        if (rest === "") {
          return problem("Write the goal after goal. Example: goal Learn programming");
        }
        const goal: Goal = { id: nextIdFor(goals), userId: "local", title: rest };
        goals.push(goal);
        const detail = `#${goal.id} ${rest}`;
        if (saveGoals()) {
          return {
            ok: true,
            lines: [`Added and saved goal ${goal.id}: ${rest}`],
            logs: [{ action: "goal.add", detail, ok: true }],
          };
        }
        goals.pop();
        return {
          ok: false,
          lines: ["Could not save the goal. Nothing was added."],
          logs: [{ action: "goal.add", detail, ok: false }],
        };
      },
    },
    {
      name: "goals",
      usage: "goals",
      about: "show all goals and progress",
      run: () => {
        if (goals.length === 0) {
          return say("No goals yet.");
        }
        const lines: string[] = [];
        for (const goal of goals) {
          const goalTasks = tasks.filter((t) => t.goalId === goal.id);
          const doneCount = goalTasks.filter((t) => t.done).length;
          lines.push(
            `${goal.id}. ${goal.title}: ${doneCount} of ${goalTasks.length} task(s) done`
          );
        }
        return say(...lines);
      },
    },
    {
      name: "rename goal",
      usage: "rename goal <n> <title>",
      about: "change a goal title",
      run: (rest) => {
        const { first, others } = splitFirst(rest);
        const id = toId(first);
        if (id === null || others === "") {
          return problem("Use: rename goal <number> <new title>");
        }
        const goal = goals.find((g) => g.id === id);
        if (goal === undefined) {
          return problem(`There is no goal ${id}.`);
        }
        const oldTitle = goal.title;
        goal.title = others;
        const detail = `#${id} ${oldTitle} -> ${others}`;
        if (saveGoals()) {
          return {
            ok: true,
            lines: [`Renamed goal ${id}: ${oldTitle} -> ${others}`],
            logs: [{ action: "goal.rename", detail, ok: true }],
          };
        }
        goal.title = oldTitle;
        return {
          ok: false,
          lines: ["Could not save the new title. Nothing was changed."],
          logs: [{ action: "goal.rename", detail, ok: false }],
        };
      },
    },
    {
      name: "delete goal",
      usage: "delete goal <n>",
      about: "delete a goal (asks first)",
      run: (rest) => {
        const id = toId(rest);
        if (id === null) {
          return problem("Use: delete goal <number>");
        }
        const goal = goals.find((g) => g.id === id);
        if (goal === undefined) {
          return problem(`There is no goal ${id}.`);
        }
        const count = tasks.filter((t) => t.goalId === goal.id).length;
        return {
          ok: true,
          lines: [
            `Delete goal ${goal.id}: ${goal.title}?`,
            `${count} task(s) will stay, but without this goal. Type yes to confirm.`,
          ],
          confirm: () => deleteGoal(goal),
        };
      },
    },
  ],
};
