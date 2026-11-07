import express, { Express } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import cors from "cors";
import path from "node:path";
import rateLimit from "express-rate-limit";
import { authRouter, requireAuth, AuthedRequest } from "./auth.js";
import { itemsRouter } from "./items.js";

// Per-user limiter for the LLM endpoint (protects your API credit).
// Must run AFTER requireAuth so that req.userId is already set.
export const llmLimiter = rateLimit({
  windowMs: 60_000,
  limit: 15,
  keyGenerator: (req) => (req as AuthedRequest).userId || "anon",
  message: { error: "too many requests, slow down" },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  message: { error: "too many attempts, try later" },
});

const generalLimiter = rateLimit({ windowMs: 60_000, limit: 300 });

const webDir = path.join(process.cwd(), "src", "cloud", "web");
const json = express.json({ limit: "100kb" });

export function mountCloud(app: Express) {
  app.set("trust proxy", 1); // Railway / Render sit behind a proxy

  // CSP is off so the existing inline-script web page keeps working.
  app.use(helmet({ contentSecurityPolicy: false }));

  const origin = process.env.ALLOWED_ORIGIN;
  if (origin) app.use(cors({ origin, credentials: true }));

  app.use(cookieParser());

  app.get("/health", (_req, res) => res.json({ ok: true }));

  // Login page + guard script (public, no login needed)
  app.get("/login", (_req, res) => res.sendFile(path.join(webDir, "login.html")));
  app.get("/cloud-auth-guard.js", (_req, res) => res.sendFile(path.join(webDir, "auth-guard.js")));

  // NOTE: the JSON body parser is applied ONLY to our own routes below,
  // so it never consumes the request body that your original handler needs to read.
  app.use("/api/auth", authLimiter, json, authRouter);

  // Everything else under /api requires login (then continues to your old handler).
  app.use("/api", requireAuth, generalLimiter);
  app.use("/api/items", json, itemsRouter);
}

export { requireAuth };
