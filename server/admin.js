import crypto from "node:crypto";
import express from "express";
import rateLimit from "express-rate-limit";
import { ObjectId } from "mongodb";

const COOKIE_NAME = "exeplanner_admin_session";
const SESSION_MS = 8 * 60 * 60 * 1000;
const PAGE_SIZE = 25;
const hash = (value) => crypto.createHash("sha256").update(value).digest();
const forwarded = (req, name) => req.get(name)?.split(",")[0].trim();
const isSecure = (req) => req.secure || forwarded(req, "x-forwarded-proto") === "https";
const cookieOptions = (req) => ({
  httpOnly: true,
  sameSite: "strict",
  path: "/api/admin",
  secure: isSecure(req),
});
const sessionToken = (req) => req.get("cookie")?.split(";")
  .map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`))
  ?.slice(COOKIE_NAME.length + 1);

export function createAdminRouter({ getPlans, username, password }) {
  const router = express.Router();
  const sessions = new Map();
  const configured = typeof username === "string" && username.length > 0
    && typeof password === "string" && password.length > 0;
  const usernameHash = hash(configured ? username : "");
  const passwordHash = hash(configured ? password : "");

  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    const now = Date.now();
    for (const [token, expiresAt] of sessions) {
      if (expiresAt <= now) sessions.delete(token);
    }
    if (!configured) return res.status(503).json({ error: "Administración no configurada" });
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.get("origin");
      const host = req.get("host");
      let allowed = req.get("sec-fetch-site") !== "cross-site";
      if (origin) {
        try {
          const expected = new URL(`${isSecure(req) ? "https" : "http"}://${host}`).origin;
          allowed = allowed && origin === expected;
        } catch {
          allowed = false;
        }
      }
      if (!allowed) return res.status(403).json({ error: "Origen no permitido" });
    }
    next();
  });

  const loginLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    // Without a configured trusted proxy, use the socket IP, never a spoofable XFF.
    validate: { xForwardedForHeader: false },
    message: { error: "Demasiados intentos de acceso. Inténtalo más tarde" },
  });

  router.post("/session", loginLimit, express.json({ limit: "4kb" }), (req, res) => {
    const suppliedUsername = typeof req.body?.username === "string" ? req.body.username : "";
    const suppliedPassword = typeof req.body?.password === "string" ? req.body.password : "";
    const validUsername = crypto.timingSafeEqual(hash(suppliedUsername), usernameHash);
    const validPassword = crypto.timingSafeEqual(hash(suppliedPassword), passwordHash);
    if (!validUsername || !validPassword) {
      return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
    }
    sessions.delete(sessionToken(req));
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, Date.now() + SESSION_MS);
    res.cookie(COOKIE_NAME, token, { ...cookieOptions(req), maxAge: SESSION_MS });
    res.json({ authenticated: true });
  });

  router.use((req, res, next) => {
    if (!sessions.has(sessionToken(req))) {
      return res.status(401).json({ error: "Sesión ausente o expirada" });
    }
    next();
  });

  router.get("/session", (req, res) => res.json({ authenticated: true }));
  router.delete("/session", (req, res) => {
    sessions.delete(sessionToken(req));
    res.clearCookie(COOKIE_NAME, cookieOptions(req));
    res.json({ authenticated: false });
  });

  router.get("/plans", async (req, res) => {
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    if ((req.query.page !== undefined && (typeof req.query.page !== "string" || !/^[1-9]\d*$/.test(req.query.page)))
      || !Number.isSafeInteger(page) || !Number.isSafeInteger(page * PAGE_SIZE)) {
      return res.status(400).json({ error: "Página no válida" });
    }
    const filter = {};
    for (const [key, field] of [["name", "prescribedPlan.name"], ["student", "prescribedPlan.student"]]) {
      const value = req.query[key];
      if (value === undefined) continue;
      if (typeof value !== "string" || value.length > 200) {
        return res.status(400).json({ error: "Filtro de texto no válido" });
      }
      if (value.trim()) filter[field] = { $regex: value.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    }
    for (const key of ["createdAt", "updatedAt"]) {
      const value = req.query[key];
      if (value === undefined || value === "") continue;
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return res.status(400).json({ error: "Filtro de fecha no válido" });
      }
      const start = new Date(`${value}T00:00:00.000Z`);
      if (!Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== value) {
        return res.status(400).json({ error: "Filtro de fecha no válido" });
      }
      filter[key] = { $gte: start, $lt: new Date(start.getTime() + 86_400_000) };
    }
    try {
      const collection = getPlans();
      if (!collection) return res.status(503).json({ error: "Base de datos no disponible" });
      const projection = {
        _id: 1, "prescribedPlan.name": 1, "prescribedPlan.student": 1,
        createdAt: 1, updatedAt: 1, prescriberToken: 1, studentToken: 1,
      };
      const [documents, total] = await Promise.all([
        collection.find(filter, { projection }).sort({ updatedAt: -1, _id: -1 })
          .skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).toArray(),
        collection.countDocuments(filter),
      ]);
      const plans = documents.map((doc) => ({
        id: String(doc._id),
        name: doc.prescribedPlan?.name || "",
        student: doc.prescribedPlan?.student || "",
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        prescriberToken: doc.prescriberToken,
        studentToken: doc.studentToken,
      }));
      res.json({ plans, page, total, pages: Math.ceil(total / PAGE_SIZE) });
    } catch {
      res.status(500).json({ error: "No se pudieron cargar las planificaciones" });
    }
  });

  router.delete("/plans/:id", async (req, res) => {
    if (!/^[a-f0-9]{24}$/i.test(req.params.id)) {
      return res.status(400).json({ error: "Identificador de planificación no válido" });
    }
    try {
      const collection = getPlans();
      if (!collection) return res.status(503).json({ error: "Base de datos no disponible" });
      const result = await collection.deleteOne({ _id: new ObjectId(req.params.id) });
      if (!result.deletedCount) return res.status(404).json({ error: "Planificación no encontrada" });
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "No se pudo eliminar la planificación" });
    }
  });

  router.use((error, req, res, next) => {
    if (error.type === "entity.too.large") {
      return res.status(413).json({ error: "Solicitud demasiado grande" });
    }
    if (error.type === "entity.parse.failed") {
      return res.status(400).json({ error: "JSON no válido" });
    }
    res.status(500).json({ error: "Error de administración" });
  });
  return router;
}
