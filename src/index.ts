import { acquireInstance } from "./core/instance";
import { goals, loadData, tasks } from "./core/data";
import { startApp } from "./core/app";
import { tasksModule } from "./modules/tasks";
import { goalsModule } from "./modules/goals";
import { remindersModule } from "./modules/reminders";
import { notifyModule } from "./modules/notify";
import { autostartModule } from "./modules/autostart";
import { systemModule } from "./modules/system";
import { backupModule } from "./modules/backup";
import { habitsModule } from "./modules/habits";
import { webModule } from "./modules/web";
import { activityModule } from "./modules/activity";
import { helloModule } from "./modules/hello";
import { agentModule } from "./agent/module";

// Only one Anzu at a time. Exit code 2 = another one is already running.
const lock = acquireInstance();
if (!lock.ok) {
  for (const line of lock.lines) {
    console.log(line);
  }
  process.exit(2);
}

loadData();

startApp(
  [
    tasksModule,
    goalsModule,
    remindersModule,
    notifyModule,
    autostartModule,
    systemModule,
    backupModule,
    activityModule,
    habitsModule,
    webModule,
    helloModule,
    agentModule,
  ],
  () => {
    return `Anzu is ready. I have ${tasks.length} task(s) and ${goals.length} goal(s). Type help.`;
  }
);
