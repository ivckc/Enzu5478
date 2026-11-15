import type { Module, Notice, Result } from "../core/types";
import { readJsonArray, saveJsonArray } from "../core/storage";
import { problem, say } from "../core/result";
import { splitFirst } from "../core/parse";
import { DataDamaged, damagedLines, perUserArray } from "../core/userctx";

// Anzu's OWN notification center.
//
// Every message Anzu wants to tell you (a reminder, the morning brief, the weekly report, a
// medicine time ...) is a "notice". This module keeps each user's notices in inbox.json, and the
// web page shows them wherever it is open: a pop-up, a bell with a counter, a sound, and a list.
// (ntfy still works too: it is just one more place a notice can go.)

const FILE = "inbox.json";
const MAX_ITEMS = 200;
const SNAPSHOT_ITEMS = 30;
const MAX_TITLE = 120;
const MAX_MESSAGE = 1000;

type Item = {
  id: number; // grows all the time (even after "clear"), so the page can tell what is new
  time: string; // ISO time (UTC)
  title: string;
  message: string;
  priority: number;
  tags: string[];
  read: boolean;
};

function isItem(x: unknown): x is Item {
  if (typeof x !== "object" || x === null) {
    return false;
  }
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "number" && typeof o.time === "string" && !Number.isNaN(Date.parse(o.time)) &&
    typeof o.title === "string" && typeof o.message === "string" && typeof o.priority === "number" &&
    Array.isArray(o.tags) && typeof o.read === "boolean"
  );
}

// A different list for each user (from that user's own inbox.json).
const items: Item[] = perUserArray<Item>(() => {
  const loaded = readJsonArray<unknown>(FILE);
  if (loaded === null || !loaded.every(isItem)) {
    throw new DataDamaged([
      "inbox.json is damaged.",
      "I stopped so I do not overwrite it.",
      "Fix it or rename it, then run me again.",
    ]);
  }
  return loaded as Item[];
});

function save(): boolean {
  return saveJsonArray(FILE, items);
}

function nextId(): number {
  let top = 0;
  for (const item of items) {
    if (item.id > top) {
      top = item.id;
    }
  }
  return Math.max(Date.now(), top + 1);
}

function unreadCount(): number {
  return items.filter((i) => !i.read).length;
}

function timeText(iso: string): string {
  return iso.slice(0, 16).replace("T", " ") + " UTC";
}

export const inboxModule: Module = {
  name: "inbox",
  init: () => {
    try {
      void items.length; // checks the owner's file now; other users load when they first use it
    } catch (e) {
      return damagedLines(e);
    }
    return [];
  },
  // The page reads this on every refresh.
  snapshot: () => ({
    unread: unreadCount(),
    items: items.slice(-SNAPSHOT_ITEMS).reverse(), // newest first
  }),
  // Every notice from every module lands here (for the user it belongs to).
  onNotice: (notice: Notice): Result | null => {
    items.push({
      id: nextId(),
      time: new Date().toISOString(),
      title: notice.title.slice(0, MAX_TITLE),
      message: notice.message.slice(0, MAX_MESSAGE),
      priority: notice.priority ?? 3,
      tags: notice.tags ?? [],
      read: false,
    });
    while (items.length > MAX_ITEMS) {
      items.shift();
    }
    if (save()) {
      return null;
    }
    items.pop();
    return {
      ok: false,
      lines: ["Note: I could not save a notification in the inbox."],
      logs: [{ action: "inbox.save", detail: "could not save", ok: false, actor: "anzu" }],
    };
  },
  commands: [
    {
      name: "inbox",
      usage: "inbox [read|clear|test]",
      about: "Anzu's own notifications: list, mark read, clear, or send a test",
      run: (rest) => {
        const { first } = splitFirst(rest);
        if (first === "") {
          if (items.length === 0) {
            return say("لا اكو إشعارات.");
          }
          const last = items.slice(-10).reverse();
          return say(
            `الإشعارات: ${items.length} (غير المقروء ${unreadCount()})`,
            ...last.map((i) => `${i.read ? " " : "•"} ${timeText(i.time)}  ${i.title}`)
          );
        }
        if (first === "read") {
          const before = unreadCount();
          if (before === 0) {
            return say("كل الإشعارات مقروءة.");
          }
          for (const i of items) {
            i.read = true;
          }
          if (save()) {
            return say("تم تعليم الكل كمقروء."); // no log line: reading is not worth an activity entry
          }
          for (const i of items.slice(-before)) {
            i.read = false;
          }
          return { ok: false, lines: ["ما قدرت أحفظ التغيير."] };
        }
        if (first === "clear") {
          if (items.length === 0) {
            return say("الصندوق فاضي.");
          }
          return {
            ok: true,
            lines: [`مسح كل الإشعارات (${items.length})؟ اكتب yes للتأكيد.`],
            confirm: () => {
              const old = items.slice();
              items.splice(0, items.length);
              if (save()) {
                return say("تم مسح الإشعارات.");
              }
              items.push(...old);
              return { ok: false, lines: ["ما قدرت أحفظ التغيير."] };
            },
          };
        }
        if (first === "test") {
          return {
            ok: true,
            lines: ["أرسلت إشعاراً تجريبياً."],
            notices: [
              {
                title: "🔔 إشعار تجريبي",
                message: "إذا شفت هذا الإشعار فالإشعارات تشتغل على هذا الجهاز.",
                priority: 3,
                tags: ["bell"],
              },
            ],
          };
        }
        return problem("ما فهمت. اكتب: inbox  أو  inbox read | clear | test");
      },
    },
  ],
};
