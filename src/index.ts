import { goals, loadData, tasks } from "./core/data";
import { startApp } from "./core/app";
import { tasksModule } from "./modules/tasks";
import { goalsModule } from "./modules/goals";
   import { helloModule } from "./modules/hello";
loadData();

startApp([tasksModule, goalsModule,helloModule], () => {
  return `Anzu is ready. I have ${tasks.length} task(s) and ${goals.length} goal(s). Type help.`;
});
