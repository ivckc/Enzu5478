import type { Goal, Module } from "../core/types";
import { goals, saveGoals, saveTasks, tasks } from "../core/data";
import { nextIdFor } from "../core/storage";
import { splitFirst, toId } from "../core/parse";

function deleteGoal(goal: Goal): void {
  const linked = tasks.filter((t) => t.goalId === goal.id);
  for (const t of linked) {
    t.goalId = null;
  }
  if (linked.length > 0 && !saveTasks()) {
    for (const t of linked) {
      t.goalId = goal.id;
    }
    console.log("Could not save the tasks. Nothing was deleted.");
    return;
  }
  const index = goals.indexOf(goal);
  goals.splice(index, 1);
  if (saveGoals()) {
    console.log(`Deleted goal ${goal.id}: ${goal.title}`);
  } else {
    goals.splice(index, 0, goal);
    console.log("The tasks were unlinked, but the goal could not be deleted.");
    console.log("No task was lost. You can try again.");
  }
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
          console.log("Write the goal after goal. Example: goal Learn programming");
          return;
        }
        const goal: Goal = { id: nextIdFor(goals), userId: "local", title: rest };
        goals.push(goal);
        if (saveGoals()) {
          console.log(`Added and saved goal ${goal.id}: ${rest}`);
        } else {
          goals.pop();
          console.log("Could not save the goal. Nothing was added.");
        }
      },
    },
    {
      name: "goals",
      usage: "goals",
      about: "show all goals and progress",
      run: () => {
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
          console.log("Use: rename goal <number> <new title>");
          return;
        }
        const goal = goals.find((g) => g.id === id);
        if (goal === undefined) {
          console.log(`There is no goal ${id}.`);
          return;
        }
        const oldTitle = goal.title;
        goal.title = others;
        if (saveGoals()) {
          console.log(`Renamed goal ${id}: ${oldTitle} -> ${others}`);
        } else {
          goal.title = oldTitle;
          console.log("Could not save the new title. Nothing was changed.");
        }
      },
    },
    {
      name: "delete goal",
      usage: "delete goal <n>",
      about: "delete a goal (asks first)",
      run: (rest, ctx) => {
        const id = toId(rest);
        if (id === null) {
          console.log("Use: delete goal <number>");
          return;
        }
        const goal = goals.find((g) => g.id === id);
        if (goal === undefined) {
          console.log(`There is no goal ${id}.`);
          return;
        }
        const count = tasks.filter((t) => t.goalId === goal.id).length;
        console.log(`Delete goal ${goal.id}: ${goal.title}?`);
        console.log(`${count} task(s) will stay, but without this goal. Type yes to confirm.`);
        ctx.confirm(() => deleteGoal(goal));
      },
    },
  ],
};
