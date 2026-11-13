import { Router, Response } from "express";
import { randomUUID } from "node:crypto";
import { db, KINDS, Kind } from "./db.js";
import { AuthedRequest } from "./auth.js";

export const itemsRouter = Router();

function kindOk(k: string): k is Kind {
  return (KINDS as readonly string[]).includes(k);
}
function parseBody(body: unknown): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const s = JSON.stringify(body);
  return s.length <= 50_000 ? s : null;
}

// Every query below filters by user_id taken from the verified JWT, never from the client.

itemsRouter.get("/:kind", (req: AuthedRequest, res: Response) => {
  if (!kindOk(String(req.params.kind))) return res.status(404).json({ error: "unknown kind" });
  const rows = db
    .prepare("SELECT id, data, created_at, updated_at FROM items WHERE user_id = ? AND kind = ? ORDER BY created_at DESC")
    .all(req.userId, req.params.kind) as any[];
  res.json(rows.map((r) => ({ id: r.id, ...JSON.parse(r.data), createdAt: r.created_at, updatedAt: r.updated_at })));
});

itemsRouter.post("/:kind", (req: AuthedRequest, res: Response) => {
  if (!kindOk(String(req.params.kind))) return res.status(404).json({ error: "unknown kind" });
  const data = parseBody(req.body);
  if (!data) return res.status(400).json({ error: "invalid body" });
  const id = randomUUID();
  const now = Date.now();
  db.prepare("INSERT INTO items (id, user_id, kind, data, created_at, updated_at) VALUES (?,?,?,?,?,?)")
    .run(id, req.userId, req.params.kind, data, now, now);
  res.status(201).json({ id, ...JSON.parse(data), createdAt: now, updatedAt: now });
});

itemsRouter.put("/:kind/:id", (req: AuthedRequest, res: Response) => {
  if (!kindOk(String(req.params.kind))) return res.status(404).json({ error: "unknown kind" });
  const data = parseBody(req.body);
  if (!data) return res.status(400).json({ error: "invalid body" });
  const r = db
    .prepare("UPDATE items SET data = ?, updated_at = ? WHERE id = ? AND user_id = ? AND kind = ?")
    .run(data, Date.now(), req.params.id, req.userId, req.params.kind);
  if (r.changes === 0) return res.status(404).json({ error: "not found" });
  res.json({ id: req.params.id, ...JSON.parse(data) });
});

// The UI must ask the user to confirm BEFORE calling this.
itemsRouter.delete("/:kind/:id", (req: AuthedRequest, res: Response) => {
  if (!kindOk(String(req.params.kind))) return res.status(404).json({ error: "unknown kind" });
  const r = db
    .prepare("DELETE FROM items WHERE id = ? AND user_id = ? AND kind = ?")
    .run(req.params.id, req.userId, req.params.kind);
  if (r.changes === 0) return res.status(404).json({ error: "not found" });
  res.json({ ok: true });
});
