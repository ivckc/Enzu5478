import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { db } from "./db.js";

const JWT_SECRET = process.env.JWT_SECRET || "";
if (JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must be set and at least 32 characters long");
}
const INVITE_CODE = process.env.INVITE_CODE || "";
const COOKIE = "anzu_token";
const isProd = process.env.NODE_ENV === "production";

export interface AuthedRequest extends Request {
  userId?: string;
}

function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function setSession(res: Response, userId: string) {
  const token = jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: "7d" });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    maxAge: 7 * 24 * 3600 * 1000,
  });
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE];
  if (!token) return res.status(401).json({ error: "unauthorized" });
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string };
    const exists = db.prepare("SELECT 1 FROM users WHERE id = ?").get(payload.sub);
    if (!exists) return res.status(401).json({ error: "unauthorized" });
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: "unauthorized" });
  }
}

const registerSchema = z.object({
  username: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9_.-]+$/),
  password: z.string().min(10).max(200),
  inviteCode: z.string().max(200),
});
const loginSchema = z.object({
  username: z.string().max(64),
  password: z.string().max(200),
});

export const authRouter = Router();

authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input (password min 10 chars)" });
  const { username, password, inviteCode } = parsed.data;

  if (!INVITE_CODE || !safeEqual(inviteCode, INVITE_CODE)) {
    return res.status(403).json({ error: "invalid invite code" });
  }
  const taken = db.prepare("SELECT 1 FROM users WHERE username = ?").get(username);
  if (taken) return res.status(409).json({ error: "username taken" });

  const id = randomUUID();
  const hash = await bcrypt.hash(password, 12);
  db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?,?,?,?)")
    .run(id, username, hash, Date.now());
  setSession(res, id);
  res.status(201).json({ id, username });
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid input" });
  const { username, password } = parsed.data;

  const user = db.prepare("SELECT id, username, password_hash FROM users WHERE username = ?")
    .get(username) as { id: string; username: string; password_hash: string } | undefined;

  // same generic error for wrong user or wrong password
  const ok = user ? await bcrypt.compare(password, user.password_hash) : false;
  if (!user || !ok) return res.status(401).json({ error: "wrong username or password" });

  setSession(res, user.id);
  res.json({ id: user.id, username: user.username });
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, (req: AuthedRequest, res) => {
  const u = db.prepare("SELECT id, username FROM users WHERE id = ?").get(req.userId);
  res.json(u);
});
