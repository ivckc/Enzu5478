// Load .env automatically before any module reads process.env.
// Resolve relative to project root so it works from any folder.
// Never expose variable values; silently skip if file missing.
try {
  const path = require("node:path");
  const root = path.resolve(__dirname, "..");
  process.loadEnvFile(path.join(root, ".env"));
} catch {
  // .env missing — fine; agent will show clear Arabic message for missing vars.
}

import { acquireInstance } from "./core/instance";
import { goals, loadData, tasks } from "./core/data";
import { startApp } from "./core/app";
import { tasksModule } from "./modules/tasks";
import { goalsModule } from "./modules/goals";
import { remindersModule } from "./modules/reminders";
import { notifyModule } from "./modules/notify";
import { inboxModule } from "./modules/inbox";
import { weeklyModule } from "./modules/weekly";
import { briefModule } from "./modules/brief";
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
    inboxModule,
    briefModule,
    weeklyModule,
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
