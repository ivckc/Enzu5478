// Voice/chat API for the browser: /voice page + /api/voice/*
// Works with the agent loop. Confirmations (e.g. delete) are answered over HTTP.
import express, { Express, Response } from "express";
import path from "node:path";
import { AuthedRequest } from "./auth.js";
import { llmLimiter } from "./index.js";
import { runAgentLoop } from "../agent/loop.js";

type AgentMessage = Record<string, unknown>;
type Ev =
  | { type: "answer"; text: string }
  | { type: "confirm"; question: string }
  | { type: "error"; text: string };

type Session = {
  history: AgentMessage[];
  running: boolean;
  pending: { resolve: (ok: boolean) => void } | null;
  queue: Ev[];
  waiter: ((ev: Ev) => void) | null;
};

const sessions = new Map<string, Session>();

function getSession(userId: string): Session {
  let s = sessions.get(userId);
  if (!s) {
    s = { history: [], running: false, pending: null, queue: [], waiter: null };
    sessions.set(userId, s);
  }
  return s;
}

function emit(s: Session, ev: Ev) {
  if (s.waiter) {
    const w = s.waiter;
    s.waiter = null;
    w(ev);
  } else {
    s.queue.push(ev);
  }
}

function nextEvent(s: Session): Promise<Ev> {
  const q = s.queue.shift();
  if (q) return Promise.resolve(q);
  return new Promise((resolve) => {
    s.waiter = resolve;
  });
}

export function mountVoice(app: Express) {
  const webDir = path.join(process.cwd(), "src", "cloud", "web");
  app.get("/voice", (_req, res) => res.sendFile(path.join(webDir, "voice.html")));

  const r = express.Router();
  const json = express.json({ limit: "20kb" });

  // Ask ANZU (text from keyboard or from speech recognition)
  r.post("/ask", json, llmLimiter, async (req: AuthedRequest, res: Response) => {
    const s = getSession(req.userId!);
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text || text.length > 1000) return res.status(400).json({ error: "invalid text" });
    if (s.running) return res.status(409).json({ error: "busy" });

    s.running = true;
    s.queue = [];
    s.waiter = null;

    const confirmFn = (question: string) =>
      new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          s.pending = null;
          resolve(false); // no answer in 60s = cancel
        }, 60_000);
        s.pending = {
          resolve: (ok: boolean) => {
            clearTimeout(timer);
            s.pending = null;
            resolve(ok);
          },
        };
        emit(s, { type: "confirm", question });
      });

    runAgentLoop(text, confirmFn, { history: s.history, voice: true })
      .then((answer) => emit(s, { type: "answer", text: answer }))
      .catch((e) => emit(s, { type: "error", text: e instanceof Error ? e.message : String(e) }))
      .finally(() => {
        s.running = false;
      });

    res.json(await nextEvent(s));
  });

  // Answer a confirmation question (approve: true/false)
  r.post("/confirm", json, async (req: AuthedRequest, res: Response) => {
    const s = getSession(req.userId!);
    if (!s.pending) return res.status(409).json({ error: "nothing to confirm" });
    s.pending.resolve(req.body?.approve === true);
    res.json(await nextEvent(s));
  });

  // Speech -> text with Groq Whisper (the audio arrives as the raw request body)
  r.post(
    "/transcribe",
    llmLimiter,
    express.raw({ type: () => true, limit: "10mb" }),
    async (req: AuthedRequest, res: Response) => {
      try {
        const buf = req.body as Buffer;
        if (!Buffer.isBuffer(buf) || buf.length < 500) {
          return res.status(400).json({ error: "empty audio" });
        }
        const apiKey = process.env.GROQ_API_KEY || process.env.ANZU_LLM_API_KEY;
        if (!apiKey) return res.status(500).json({ error: "server not configured" });

        const type = String(req.headers["content-type"] || "audio/webm");
        const ext = type.includes("mp4") ? "mp4" : "webm";
        const form = new FormData();
        form.append("file", new Blob([new Uint8Array(buf)], { type }), `audio.${ext}`);
        form.append("model", process.env.WHISPER_MODEL || "whisper-large-v3-turbo");
        form.append("language", "ar");
        form.append("response_format", "json");

        const g = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
        });
        if (!g.ok) {
          console.error("Whisper error:", g.status);
          return res.status(502).json({ error: "transcription failed" });
        }
        const data = (await g.json()) as { text?: string };
        res.json({ text: (data.text || "").trim() });
      } catch (e) {
        console.error("transcribe error:", e instanceof Error ? e.message : e);
        res.status(500).json({ error: "server error" });
      }
    }
  );

  // Start a fresh conversation
  r.post("/reset", (req: AuthedRequest, res: Response) => {
    const s = getSession(req.userId!);
    s.history = [];
    res.json({ ok: true });
  });

  // Mounted after mountCloud(), so requireAuth already protects everything under /api
  app.use("/api/voice", r);
}