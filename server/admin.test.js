import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import test from "node:test";
import express from "express";
import { createAdminRouter } from "./admin.js";

const credentials = { username: "administrador", password: "secreto-de-prueba" };

async function setup(t, options = {}) {
  const app = express();
  app.use("/api/admin", createAdminRouter({ getPlans: () => null, ...credentials, ...options }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, { headers, body, ...init } = {}) => new Promise((resolve, reject) => {
    const req = httpRequest(`${base}/api/admin${path}`, {
      ...init, headers: { "content-type": "application/json", ...headers },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(new Response(Buffer.concat(chunks), {
        status: res.statusCode, headers: res.headers,
      })));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end(body);
  });
  const login = (options = {}) => request("/session", {
    method: "POST", body: JSON.stringify(credentials), ...options,
  });
  return { request, login, base };
}

const cookieFrom = (response) => response.headers.get("set-cookie").split(";")[0];
const assertError = async (response, status) => {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.deepEqual(Object.keys(body), ["error"]);
  assert.equal(typeof body.error, "string");
  return body.error;
};

test("rechaza credenciales inválidas y cuerpos ausentes o malformados sin crear cookies", async (t) => {
  const { request } = await setup(t);
  for (const body of [undefined, {}, { ...credentials, username: "otro" },
    { ...credentials, password: "incorrecta" }, { username: [], password: {} }]) {
    const response = await request("/session", { method: "POST", body: JSON.stringify(body) });
    await assertError(response, 401);
    assert.equal(response.headers.get("set-cookie"), null);
  }
  await assertError(await request("/session", { method: "POST", body: "{" }), 400);
  await assertError(await request("/session", { method: "POST", body: "null" }), 400);
  await assertError(await request("/session", { method: "POST", body: JSON.stringify({ password: "a".repeat(5000) }) }), 413);
});

test("cookie privada, opaca, con duración de ocho horas y sin exponer credenciales", async (t) => {
  const { login } = await setup(t);
  const before = Date.now();
  const response = await login();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.deepEqual(await response.json(), { authenticated: true });
  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, /^exeplanner_admin_session=[a-f0-9]{64};/);
  assert.match(cookie, /; HttpOnly/);
  assert.match(cookie, /; SameSite=Strict/);
  assert.match(cookie, /; Path=\/api\/admin/);
  assert.match(cookie, /; Max-Age=28800/);
  assert.doesNotMatch(cookie, /; Secure/);
  const expiry = Date.parse(cookie.match(/Expires=([^;]+)/)[1]);
  assert.ok(Math.abs(expiry - before - 8 * 60 * 60 * 1000) < 5000);
  assert.notEqual(cookieFrom(await login()), cookieFrom(response));
});

test("sesión, rotación de token y logout con invalidación real", async (t) => {
  const { request, login } = await setup(t);
  await assertError(await request("/session"), 401);
  await assertError(await request("/plans"), 401);
  await assertError(await request("/session", { headers: { cookie: "exeplanner_admin_session=inventada" } }), 401);
  const oldCookie = cookieFrom(await login());
  const renewed = await login({ headers: { cookie: oldCookie } });
  const cookie = cookieFrom(renewed);
  await assertError(await request("/session", { headers: { cookie: oldCookie } }), 401);
  const response = await request("/session", { headers: { cookie: `otra=1; ${cookie}` } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: true });
  const logout = await request("/session", { method: "DELETE", headers: { cookie } });
  assert.equal(logout.status, 200);
  assert.deepEqual(await logout.json(), { authenticated: false });
  assert.match(logout.headers.get("set-cookie"), /Expires=Thu, 01 Jan 1970/);
  assert.match(logout.headers.get("set-cookie"), /Path=\/api\/admin/);
  await assertError(await request("/session", { headers: { cookie } }), 401);
  await assertError(await request("/plans", { headers: { cookie } }), 401);
  await assertError(await request("/session", { method: "DELETE", headers: { cookie } }), 401);
});

test("sesión expirada devuelve 401 sin renovar la expiración al consultar", async (t) => {
  const { request, login } = await setup(t);
  const start = Date.now();
  t.mock.method(Date, "now", () => start);
  const cookie = cookieFrom(await login());
  t.mock.method(Date, "now", () => start + 7 * 60 * 60 * 1000);
  assert.equal((await request("/session", { headers: { cookie } })).status, 200);
  t.mock.method(Date, "now", () => start + 8 * 60 * 60 * 1000);
  await assertError(await request("/session", { headers: { cookie } }), 401);
  await assertError(await request("/plans", { headers: { cookie } }), 401);
});

test("sin ambas credenciales configuradas devuelve 503, nunca defaults", async (t) => {
  for (const options of [{ username: undefined }, { password: undefined }, { username: "" }, { password: "" }]) {
    const { request, login } = await setup(t, options);
    await assertError(await login(), 503);
    await assertError(await request("/session"), 503);
    await assertError(await request("/plans"), 503);
    await assertError(await request("/session", { method: "DELETE" }), 503);
  }
});

test("login limitado a diez intentos sin confiar en X-Forwarded-For del cliente", async (t) => {
  const { login } = await setup(t);
  for (let attempt = 0; attempt < 10; attempt++) {
    await assertError(await login({ body: "{}", headers: { "x-forwarded-for": `192.0.2.${attempt}` } }), 401);
  }
  const response = await login();
  await assertError(response, 429);
  assert.ok(Number(response.headers.get("retry-after")) > 0);
});

test("rechaza escrituras cross-origin y permite Origin del mismo host y puerto", async (t) => {
  const { request, login, base } = await setup(t);
  for (const origin of ["https://ajeno.example", "null", `${base}.ajeno.example`, "http://127.0.0.1:1"]) {
    await assertError(await login({ headers: { origin } }), 403);
  }
  await assertError(await login({ headers: { origin: base, "sec-fetch-site": "cross-site" } }), 403);
  const cookie = cookieFrom(await login({ headers: { origin: base } }));
  await assertError(await request("/session", {
    method: "DELETE", headers: { cookie, origin: "https://ajeno.example" },
  }), 403);
  assert.equal((await request("/session", { headers: { cookie } })).status, 200);
  assert.equal((await request("/session", { method: "DELETE", headers: { cookie, origin: base } })).status, 200);
});

test("origen y cookies Secure detrás de proxy HTTPS, incluido puerto externo", async (t) => {
  const { login, request } = await setup(t);
  const headers = {
    host: "planes.example:8443",
    "x-forwarded-proto": "https", origin: "https://planes.example:8443",
  };
  const response = await login({ headers });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /; Secure/);
  await assertError(await login({ headers: { ...headers, origin: "http://planes.example:8443" } }), 403);
  await assertError(await login({ headers: { ...headers, origin: "https://planes.example" } }), 403);
  const logout = await request("/session", { method: "DELETE", headers: { ...headers, cookie: cookieFrom(response) } });
  assert.match(logout.headers.get("set-cookie"), /; Secure/);
  const nginx = await login({ headers: { host: "planes.example", "x-forwarded-proto": "https", origin: "https://planes.example" } });
  assert.equal(nginx.status, 200);
  await assertError(await login({ headers: {
    host: "planes.example", "x-forwarded-host": "ajeno.example",
    "x-forwarded-proto": "https", origin: "https://ajeno.example",
  } }), 403);
});

test("cookie Secure cuando Express considera segura la conexión", async (t) => {
  const app = express();
  app.set("trust proxy", "loopback");
  app.use("/api/admin", createAdminRouter({ ...credentials, getPlans: () => null }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/session`, {
    method: "POST", headers: { "content-type": "application/json", "x-forwarded-proto": "https" },
    body: JSON.stringify(credentials),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /; Secure/);
});

test("listado paginado, orden estable y proyección mínima sin datos médicos ni ejecución", async (t) => {
  const calls = [];
  const documents = Array.from({ length: 51 }, (_, index) => ({
    _id: String(index + 1).padStart(3, "0"),
    prescribedPlan: { name: `Plan ${index}`, student: `Alumno ${index}`, studentProfile: { medical: "privado" }, sessions: ["privado"] },
    createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-02-01"),
    prescriberToken: `p${index}`, studentToken: `s${index}`, execution: { private: true }, sessionDates: { private: true },
  }));
  const collection = {
    find(filter, options) {
      assert.deepEqual(filter, {});
      assert.deepEqual(options.projection, {
        _id: 1, "prescribedPlan.name": 1, "prescribedPlan.student": 1,
        createdAt: 1, updatedAt: 1, prescriberToken: 1, studentToken: 1,
      });
      const call = {};
      calls.push(call);
      return {
        sort(value) { assert.deepEqual(value, { updatedAt: -1, _id: -1 }); return this; },
        skip(value) { call.skip = value; return this; },
        limit(value) { call.limit = value; return this; },
        async toArray() { return [...documents].reverse().slice(call.skip, call.skip + call.limit); },
      };
    },
    async countDocuments(filter) { assert.deepEqual(filter, {}); return documents.length; },
  };
  const { request, login } = await setup(t, { getPlans: () => collection });
  await assertError(await request("/plans"), 401);
  assert.equal(calls.length, 0);
  const headers = { cookie: cookieFrom(await login()) };
  for (const [query, page, length, firstId] of [["", 1, 25, "051"], ["?page=2&limit=1000", 2, 25, "026"], ["?page=3", 3, 1, "001"], ["?page=4", 4, 0, undefined]]) {
    const response = await request(`/plans${query}`, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.deepEqual(Object.keys(body), ["plans", "page", "total", "pages"]);
    assert.equal(body.page, page);
    assert.equal(body.total, 51);
    assert.equal(body.pages, 3);
    assert.equal(body.plans.length, length);
    assert.equal(body.plans[0]?.id, firstId);
    assert.deepEqual(calls.at(-1), { skip: (page - 1) * 25, limit: 25 });
    for (const plan of body.plans) {
      const original = documents.find((doc) => doc._id === plan.id);
      assert.deepEqual(plan, {
        id: original._id, name: original.prescribedPlan.name, student: original.prescribedPlan.student,
        createdAt: original.createdAt.toISOString(), updatedAt: original.updatedAt.toISOString(),
        prescriberToken: original.prescriberToken, studentToken: original.studentToken,
      });
    }
    assert.doesNotMatch(JSON.stringify(body), /privado|studentProfile|execution|sessionDates/);
  }
  for (const query of ["0", "-1", "1.5", "abc", "", "9007199254740991", "1&page=2"]) {
    await assertError(await request(`/plans?page=${query}`, { headers }), 400);
  }
  assert.equal(calls.length, 4);
});

test("filtros combinados aplicados antes de paginar y contar, con texto literal", async (t) => {
  const filters = [];
  const expected = {
    "prescribedPlan.name": { $regex: "Fuerza", $options: "i" },
    "prescribedPlan.student": { $regex: "Ana\\.\\*", $options: "i" },
    createdAt: { $gte: new Date("2026-11-22T00:00:00Z"), $lt: new Date("2026-11-23T00:00:00Z") },
    updatedAt: { $gte: new Date("2026-11-23T00:00:00Z"), $lt: new Date("2026-11-24T00:00:00Z") },
  };
  const { request, login } = await setup(t, { getPlans: () => ({
    find(filter) {
      filters.push(filter);
      return { sort() { return this; }, skip(value) { assert.equal(value, 25); return this; },
        limit(value) { assert.equal(value, 25); return this; }, async toArray() { return [{ _id: "26", prescribedPlan: { student: "Ana.*" } }]; } };
    },
    async countDocuments(filter) { filters.push(filter); return 26; },
  }) });
  const headers = { cookie: cookieFrom(await login()) };
  const response = await request("/plans?page=2&name=%20Fuerza%20&student=Ana.*&createdAt=2026-11-22&updatedAt=2026-11-23", { headers });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.total, 26);
  assert.equal(data.pages, 2);
  assert.equal(data.plans[0].student, "Ana.*");
  assert.deepEqual(filters, [expected, expected]);
  for (const query of ["student=a&student=b", `name=${"a".repeat(201)}`, "createdAt=2026-02-30", "updatedAt=no", "createdAt=2026-13-01", "updatedAt=2026-01-01&updatedAt=2026-01-02"]) {
    await assertError(await request(`/plans?${query}`, { headers }), 400);
  }
  assert.equal(filters.length, 2);
});

test("eliminación protegida, definitiva y limitada al identificador solicitado", async (t) => {
  const id = "507f1f77bcf86cd799439011";
  const documents = new Map([[id, { execution: { private: true }, sessionDates: { private: true } }],
    ["507f1f77bcf86cd799439012", { name: "Conservar" }]]);
  let calls = 0;
  const { request, login, base } = await setup(t, { getPlans: () => ({
    async deleteOne(filter) {
      calls++;
      assert.deepEqual(Object.keys(filter), ["_id"]);
      assert.equal(filter._id.constructor.name, "ObjectId");
      return { deletedCount: Number(documents.delete(String(filter._id))) };
    },
  }) });
  await assertError(await request(`/plans/${id}`, { method: "DELETE" }), 401);
  const cookie = cookieFrom(await login());
  await assertError(await request(`/plans/${id}`, { method: "DELETE", headers: { cookie, origin: "https://ajeno.example" } }), 403);
  await assertError(await request("/plans/incorrecto", { method: "DELETE", headers: { cookie } }), 400);
  assert.equal(calls, 0);
  const response = await request(`/plans/${id}`, { method: "DELETE", headers: { cookie, origin: base } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(documents.has(id), false);
  assert.equal(documents.size, 1);
  await assertError(await request(`/plans/${id}`, { method: "DELETE", headers: { cookie } }), 404);
});

test("eliminación informa indisponibilidad y oculta errores internos", async (t) => {
  let collection = null;
  const { request, login } = await setup(t, { getPlans: () => collection });
  const headers = { cookie: cookieFrom(await login()) };
  const remove = () => request("/plans/507f1f77bcf86cd799439011", { method: "DELETE", headers });
  await assertError(await remove(), 503);
  collection = { async deleteOne() { throw new Error("credenciales privadas"); } };
  assert.equal(await assertError(await remove(), 500), "No se pudo eliminar la planificación");
});

test("listado vacío y errores de base de datos sin filtrar detalles internos", async (t) => {
  const emptyCursor = { sort() { return this; }, skip() { return this; }, limit() { return this; }, async toArray() { return []; } };
  let collection = { find: () => emptyCursor, countDocuments: async () => 0 };
  const { login, request } = await setup(t, { getPlans: () => collection });
  const headers = { cookie: cookieFrom(await login()) };
  const response = await request("/plans", { headers });
  assert.deepEqual(await response.json(), { plans: [], page: 1, total: 0, pages: 0 });
  collection = null;
  await assertError(await request("/plans", { headers }), 503);
  collection = { find() { throw new Error("mongodb://usuario:secreto@servidor"); } };
  assert.equal(await assertError(await request("/plans", { headers }), 500), "No se pudieron cargar las planificaciones");
  collection = { find: () => emptyCursor, countDocuments: async () => { throw new Error("Error interno"); } };
  await assertError(await request("/plans", { headers }), 500);
});
