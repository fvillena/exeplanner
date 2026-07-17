import crypto from "node:crypto";
import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { MongoClient } from "mongodb";

const app = express();
const port = Number(process.env.PORT || 3001);
const mongoUri = process.env.MONGODB_URI || "mongodb://root:Gatos@127.0.0.1:27017/exeplanner?authSource=admin";
const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 5000 });
let plans;

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") || true }));
app.use(express.json({ limit: "2mb" }));
app.use(rateLimit({ windowMs: 60_000, limit: 120 }));

const token = () => crypto.randomBytes(9).toString("base64url").slice(0, 12);
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const cleanPlan = (plan) => {
  // The API receives the public schema, but accept the editor's normalized
  // shape as well so a stale client cannot invalidate an otherwise valid plan.
  if (plan?.version === 2 && Array.isArray(plan.weeks) && !Array.isArray(plan.sessions)) {
    const firstWeek = plan.weeks[0];
    plan = {
      version: 2,
      name: plan.name || "",
      student: plan.student || "",
      studentProfile: plan.studentProfile || {},
      startDate: plan.startDate || "",
      generalNotes: plan.generalNotes || "",
      sessions: (firstWeek?.days || []).map((day, index) => ({
        id: day.id,
        name: day.name || `Sesión ${index + 1}`,
        exercises: (day.exercises || []).map((exercise, exerciseIndex) => ({
          id: exercise.id,
          name: exercise.name || "Nuevo ejercicio",
          description: exercise.description || "",
          type: exercise.type || "strength",
          order: exerciseIndex + 1,
          plan: plan.weeks.map((week) => ({
            week: week.number,
            ...(week.days?.find((item) => item.id === day.id)?.exercises?.find((item) => item.id === exercise.id) || {}),
          })),
        })),
      })),
    };
  }
  if (!plan || plan.version !== 2 || !Array.isArray(plan.sessions) || !plan.sessions.length)
    throw new Error("El plan no tiene un formato válido");
  for (const session of plan.sessions) {
    if (!Number.isInteger(session.id) || !Array.isArray(session.exercises)) throw new Error("Sesión inválida");
    for (const exercise of session.exercises) {
      if (!Number.isInteger(exercise.id) || !exercise.name || !Array.isArray(exercise.plan)) throw new Error("Ejercicio inválido");
    }
  }
  return structuredClone(plan);
};
const executionKey = (week, session, exercise) => `${week}:${session}:${exercise}`;
const findByToken = async (field, value) => plans.findOne({ [field]: hash(value) });
const findPlanAccess = async (value) => {
  const tokenHash = hash(value);
  const doc = await plans.findOne({ $or: [{ studentTokenHash: tokenHash }, { prescriberTokenHash: tokenHash }] });
  if (!doc) return null;
  return {
    doc,
    role: doc.prescriberTokenHash === tokenHash ? "prescriber" : "student",
  };
};
const publicDocument = (doc, includeStudentToken = false) => ({
  id: String(doc._id),
  prescribedPlan: doc.prescribedPlan,
  execution: doc.execution || {},
  sessionDates: doc.sessionDates || {},
  sharedAt: doc.sharedAt || doc.createdAt,
  updatedAt: doc.updatedAt,
  ...(includeStudentToken && doc.studentToken ? { studentToken: doc.studentToken } : {}),
});

app.get("/api/plans/access/:token", async (req, res) => {
  const access = await findPlanAccess(req.params.token);
  if (!access) return res.status(404).json({ error: "Enlace no válido" });
  res.json({ ...publicDocument(access.doc, access.role === "prescriber"), role: access.role });
});

app.get("/api/health", (_, res) => res.json({ ok: true, database: Boolean(plans) }));
app.post("/api/plans", async (req, res) => {
  try {
    if (!plans) return res.status(503).json({ error: "MongoDB no está configurado" });
    const prescribedPlan = cleanPlan(req.body);
    const studentToken = token();
    const prescriberToken = token();
    const now = new Date();
    const result = await plans.insertOne({
      studentToken,
      studentTokenHash: hash(studentToken), prescriberTokenHash: hash(prescriberToken),
      prescribedPlan, execution: {}, sessionDates: {}, sharedAt: now, createdAt: now, updatedAt: now,
    });
    res.status(201).json({ id: String(result.insertedId), studentToken, prescriberToken });
  } catch (error) { res.status(400).json({ error: error.message }); }
});
app.get("/api/student/plans/:token", async (req, res) => {
  const doc = await findByToken("studentTokenHash", req.params.token);
  if (!doc) return res.status(404).json({ error: "Enlace no válido" });
  res.json(publicDocument(doc, true));
});
app.get("/api/prescriber/plans/:token", async (req, res) => {
  const doc = await findByToken("prescriberTokenHash", req.params.token);
  if (!doc) return res.status(404).json({ error: "Enlace no válido" });
  res.json(publicDocument(doc, true));
});
app.put("/api/plans/:id/prescription", async (req, res) => {
  const doc = await findByToken("prescriberTokenHash", req.headers.authorization?.replace(/^Bearer\s+/i, "") || "");
  if (!doc || String(doc._id) !== req.params.id) return res.status(401).json({ error: "No autorizado" });
  try {
    const prescribedPlan = cleanPlan(req.body);
    const allowed = new Set(prescribedPlan.sessions.flatMap((s) => s.exercises.flatMap((e) => e.plan.map((p) => executionKey(p.week, s.id, e.id)))));
    const execution = Object.fromEntries(Object.entries(doc.execution || {}).filter(([key]) => allowed.has(key)));
    await plans.updateOne({ _id: doc._id }, { $set: { prescribedPlan, execution, updatedAt: new Date() } });
    res.json({ ok: true });
  } catch (error) { res.status(400).json({ error: error.message }); }
});
app.patch("/api/student/plans/:token/execution", async (req, res) => {
  const doc = await findByToken("studentTokenHash", req.params.token);
  if (!doc) return res.status(404).json({ error: "Enlace no válido" });
  const { week, session, exercise, values, sessionDate } = req.body;
  if (!Number.isInteger(week) || !Number.isInteger(session) || !Number.isInteger(exercise) || !values || typeof values !== "object")
    return res.status(400).json({ error: "Ejecución inválida" });
  const allowed = ["sets", "reps", "load", "metric", "intensity", "studentComment"];
  const clean = Object.fromEntries(Object.entries(values).filter(([key]) => allowed.includes(key)));
  const key = executionKey(week, session, exercise);
  const savedExecution = { ...clean, updatedAt: new Date() };
  const sessionDateKey = `${week}:${session}`;
  const dateUpdate = sessionDate === undefined
    ? {}
    : sessionDate
      ? { [`sessionDates.${sessionDateKey}`]: sessionDate }
      : { [`sessionDates.${sessionDateKey}`]: "" };
  const result = await plans.updateOne(
    { _id: doc._id },
    { $set: { [`execution.${key}`]: savedExecution, ...dateUpdate, updatedAt: new Date() } },
  );
  if (!result.matchedCount) return res.status(404).json({ error: "Plan no encontrado" });
  res.json({ ok: true, key, execution: savedExecution, sessionDate: sessionDate || "" });
});
app.patch("/api/student/plans/:token/session-date", async (req, res) => {
  const doc = await findByToken("studentTokenHash", req.params.token);
  if (!doc) return res.status(404).json({ error: "Enlace no válido" });
  const { week, session, sessionDate } = req.body;
  if (!Number.isInteger(week) || !Number.isInteger(session) || (sessionDate && !/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)))
    return res.status(400).json({ error: "Fecha de sesión inválida" });
  const key = `${week}:${session}`;
  const update = sessionDate
    ? { $set: { [`sessionDates.${key}`]: sessionDate, updatedAt: new Date() } }
    : { $unset: { [`sessionDates.${key}`]: "" }, $set: { updatedAt: new Date() } };
  await plans.updateOne({ _id: doc._id }, update);
  res.json({ ok: true, sessionDate: sessionDate || "" });
});
app.post("/api/student/plans/:token/execution/reset", async (req, res) => {
  const doc = await findByToken("studentTokenHash", req.params.token);
  if (!doc) return res.status(404).json({ error: "Enlace no válido" });
  const { week, session, exercise } = req.body;
  const key = executionKey(week, session, exercise);
  await plans.updateOne({ _id: doc._id }, { $unset: { [`execution.${key}`]: "" }, $set: { updatedAt: new Date() } });
  res.json({ ok: true, key });
});
app.post("/api/plans/:id/execution/reset", async (req, res) => {
  const doc = await findByToken("prescriberTokenHash", req.headers.authorization?.replace(/^Bearer\s+/i, "") || "");
  if (!doc || String(doc._id) !== req.params.id) return res.status(401).json({ error: "No autorizado" });
  const { week, session, exercise } = req.body;
  const key = executionKey(week, session, exercise);
  await plans.updateOne({ _id: doc._id }, { $unset: { [`execution.${key}`]: "" }, $set: { updatedAt: new Date() } });
  res.json({ ok: true, key });
});

const start = async () => {
  await client.connect();
  plans = client.db(process.env.MONGODB_DB || "exeplanner").collection("plans");
  await plans.createIndex({ studentTokenHash: 1 }, { unique: true });
  await plans.createIndex({ prescriberTokenHash: 1 }, { unique: true });
  app.listen(port, () => console.log(`Exeplanner API escuchando en ${port}`));
};
start().catch((error) => {
  console.error(`No se pudo conectar con MongoDB en ${mongoUri}`);
  console.error(error.message);
  process.exit(1);
});
