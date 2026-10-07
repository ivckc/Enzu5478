import * as fs from "node:fs";
import * as path from "node:path";
import type { Module, Result } from "../core/types";
import { problem, say } from "../core/result";

const RUNNER = "anzu-run.cmd"; // lives in the Anzu folder; double-click it to start Anzu
const LAUNCHER = "Anzu.cmd"; // lives in the Windows Startup folder; starts the runner minimized

function startupFolder(): string | null {
  const appData = process.env.APPDATA;
  if (appData === undefined || appData === "") {
    return null;
  }
  return path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
}

// Only plain characters, because a .cmd file is fragile with symbols and non-English letters.
function isSafeFolder(dir: string): boolean {
  return /^([A-Za-z]:)?[\\/][A-Za-z0-9 _.\-\\/]+$/.test(dir);
}

function crlf(lines: string[]): string {
  return lines.join("\r\n") + "\r\n";
}

// Starts Anzu. If Anzu stops by surprise (exit code 1) it starts again after 15 seconds.
// Code 0 = you typed exit. Code 2 = already running. Code 3 = a file is damaged.
function runnerText(dir: string): string {
  return crlf([
    "@echo off",
    "title Anzu",
    `cd /d "${dir}"`,
    ":run",
    "call npx tsx src/index.ts",
    "set CODE=%ERRORLEVEL%",
    "if %CODE%==0 exit /b 0",
    "if %CODE%==1 (",
    "  echo.",
    "  echo Anzu stopped unexpectedly. Starting again in 15 seconds...",
    "  timeout /t 15 /nobreak >nul",
    "  goto run",
    ")",
    "echo.",
    "echo Anzu did not start (code %CODE%). Read the message above.",
    "pause",
    "exit /b %CODE%",
  ]);
}

function launcherText(runnerPath: string): string {
  return crlf([
    "@echo off",
    "rem Starts Anzu minimized when you sign in to Windows. Made by the Anzu command: autostart on",
    `start "Anzu" /min "${runnerPath}"`,
  ]);
}

function launcherPath(): string | null {
  const folder = startupFolder();
  return folder === null ? null : path.join(folder, LAUNCHER);
}

function statusResult(): Result {
  const launcher = launcherPath();
  if (launcher === null) {
    return problem("Starting with Windows works only on Windows (I could not find the APPDATA folder).");
  }
  if (!fs.existsSync(launcher)) {
    return say("Start with Windows: OFF", "Type autostart on to turn it on.");
  }
  const lines = ["Start with Windows: ON", `Startup file: ${launcher}`];
  try {
    const match = /start "Anzu" \/min "([^"]+)"/.exec(fs.readFileSync(launcher, "utf8"));
    if (match === null) {
      lines.push("Problem: the startup file does not look like mine. Type autostart off, then autostart on.");
    } else if (!fs.existsSync(match[1])) {
      lines.push(`Problem: ${match[1]} no longer exists.`);
      lines.push("Did you move the Anzu folder? Type autostart off, then autostart on from the new folder.");
    } else {
      lines.push(`Starts: ${match[1]}`);
    }
  } catch {
    lines.push("Problem: I could not read the startup file.");
  }
  return say(...lines);
}

function turnOn(folder: string, launcher: string): Result {
  const runnerPath = path.join(folder, RUNNER);
  try {
    fs.mkdirSync(path.dirname(launcher), { recursive: true });
    fs.writeFileSync(runnerPath, runnerText(folder), "utf8");
    fs.writeFileSync(launcher, launcherText(runnerPath), "utf8");
    // Read them back to be sure.
    if (
      fs.readFileSync(runnerPath, "utf8") !== runnerText(folder) ||
      fs.readFileSync(launcher, "utf8") !== launcherText(runnerPath)
    ) {
      throw new Error("mismatch");
    }
  } catch {
    return {
      ok: false,
      lines: ["Could not create the startup files. Nothing is turned on."],
      logs: [{ action: "autostart.on", detail: "could not write the files", ok: false }],
    };
  }
  return {
    ok: true,
    lines: [
      "Start with Windows: ON",
      `I made ${RUNNER} in this folder, and ${LAUNCHER} in your Startup folder.`,
      "Anzu will start (minimized) the next time you sign in to Windows.",
      `To try it now without signing out, double-click ${RUNNER}.`,
    ],
    logs: [{ action: "autostart.on", detail: `starts ${runnerPath}`, ok: true }],
  };
}

export const autostartModule: Module = {
  name: "autostart",
  commands: [
    {
      name: "autostart",
      usage: "autostart",
      about: "start with Windows: status",
      run: (rest) => {
        if (rest !== "") {
          return problem("Use: autostart  or  autostart on | off");
        }
        return statusResult();
      },
    },
    {
      name: "autostart on",
      usage: "autostart on",
      about: "start Anzu when Windows starts",
      run: () => {
        const launcher = launcherPath();
        if (launcher === null) {
          return problem("Starting with Windows works only on Windows (I could not find the APPDATA folder).");
        }
        const folder = process.cwd();
        if (!fs.existsSync(path.join(folder, "src", "index.ts"))) {
          return problem("Run this from the Anzu folder (the one that contains src).");
        }
        if (!isSafeFolder(folder)) {
          return problem(
            `The folder path has symbols or non-English letters: ${folder}`,
            "Move Anzu to a simple path such as C:\\Anzu, then try again."
          );
        }
        return {
          ok: true,
          lines: [
            "This will create a small file in your Windows Startup folder:",
            `  ${launcher}`,
            `and ${RUNNER} in this folder. You can remove it any time with: autostart off`,
            "Type yes to continue.",
          ],
          confirm: () => turnOn(folder, launcher),
        };
      },
    },
    {
      name: "autostart off",
      usage: "autostart off",
      about: "do not start with Windows",
      run: () => {
        const launcher = launcherPath();
        if (launcher === null) {
          return problem("Starting with Windows works only on Windows (I could not find the APPDATA folder).");
        }
        if (!fs.existsSync(launcher)) {
          return say("Start with Windows is already OFF.");
        }
        try {
          fs.rmSync(launcher, { force: true });
        } catch {
          return {
            ok: false,
            lines: ["Could not remove the startup file. Nothing was changed."],
            logs: [{ action: "autostart.off", detail: "could not remove", ok: false }],
          };
        }
        return {
          ok: true,
          lines: ["Start with Windows: OFF", `(${RUNNER} stays in this folder. You can still double-click it.)`],
          logs: [{ action: "autostart.off", detail: "startup file removed", ok: true }],
        };
      },
    },
  ],
};
