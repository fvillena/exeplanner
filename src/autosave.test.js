import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import vm from "node:vm";
import { rolldown } from "rolldown";

const entry = fileURLToPath(new URL("./main.jsx", import.meta.url));
const bundle = await rolldown({
  input: entry,
  external: (id) => id !== entry,
  transform: { jsx: { runtime: "classic" } },
  plugins: [{ name: "test-app", transform: (code) => `${code}\nexport { App as TestApp };` }],
});
const { output } = await bundle.generate({ format: "cjs" });
const compiled = output[0].code;
await bundle.close();

function editor(props = {}, api = {}) {
  const hooks = [];
  const timers = new Map();
  const requests = [];
  const urls = [];
  let cursor = 0;
  let pendingEffects = [];
  let tree;
  const react = {
    createElement: (type, attributes, ...children) => ({ type, props: { ...attributes, children } }),
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial;
      return [hooks[index], (value) => { hooks[index] = typeof value === "function" ? value(hooks[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      return hooks[index] ||= { current: initial };
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      const previous = hooks[index];
      if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
        pendingEffects.push(() => {
          previous?.cleanup?.();
          hooks[index] = { dependencies, cleanup: effect() };
        });
      }
    },
    useEffectEvent: (callback) => callback,
  };
  const credentials = { id: "plan-1", prescriberToken: "coach", studentToken: "student" };
  const storage = { getItem: () => null, removeItem() {} };
  const modules = {
    react,
    "react-dom/client": { createRoot: () => ({ render() {} }) },
    jspdf: {}, qrcode: {}, "lucide-react": {}, "./styles.css": {},
    "./api": {
      publishPlan: async (plan) => {
        requests.push({ method: "POST", plan });
        return api.publishPlan ? api.publishPlan(plan) : credentials;
      },
      updatePrescription: async (id, token, plan) => {
        requests.push({ method: "PUT", id, token, plan });
        return api.updatePrescription?.(plan);
      },
      resetPrescriberExecution: async () => { requests.push({ method: "RESET" }); },
    },
  };
  const context = vm.createContext({
    exports: {}, require: (name) => modules[name], structuredClone, URLSearchParams,
    localStorage: storage, sessionStorage: storage,
    document: { getElementById: () => ({}) },
    window: {
      location: { pathname: "/", origin: "https://example.com", search: "" },
      history: { replaceState: (...args) => urls.push(args[2]) },
      setTimeout: (callback, delay) => { const id = Symbol(); timers.set(id, { callback, delay }); return id; },
      clearTimeout: (id) => timers.delete(id),
    },
  });
  vm.runInContext(compiled, context);
  const render = () => {
    cursor = 0;
    pendingEffects = [];
    tree = context.exports.TestApp(props);
    pendingEffects.forEach((effect) => effect());
  };
  const find = (predicate, node = tree) => {
    if (!node || typeof node !== "object") return undefined;
    if (predicate(node)) return node;
    return (node.props?.children || []).flat(Infinity).map((child) => find(predicate, child)).find(Boolean);
  };
  render();
  return {
    requests, urls, timers, render,
    get plan() { return hooks[0]; },
    change(name) {
      find((node) => node.type === "input" && node.props.id === "student-profile-input").props.onChange({ target: { value: name } });
      render();
    },
    async flush() {
      await new Promise((resolve) => setImmediate(resolve));
      render();
    },
    async save() {
      const scheduled = [...timers.values()];
      timers.clear();
      scheduled.forEach(({ callback }) => callback());
      await this.flush();
    },
    async retry() {
      find((node) => node.type === "button" && node.props.children.includes("Guardar")).props.onClick();
      await this.flush();
    },
  };
}

test("does not publish an untouched plan and debounces changes", async () => {
  const app = editor();
  assert.equal(app.timers.size, 0);
  app.change("Ana");
  app.change("Ana Maria");
  assert.equal(app.timers.size, 1);
  assert.equal([...app.timers.values()][0].delay, 800);
  await app.save();
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].plan.student, "Ana Maria");
  assert.deepEqual(app.urls, ["https://example.com/p/coach"]);
  assert.equal(app.timers.size, 0);
});

test("updates the published plan instead of creating another one", async () => {
  const app = editor();
  app.change("Ana");
  await app.save();
  app.change("Maria");
  await app.save();
  assert.deepEqual(app.requests.map(({ method }) => method), ["POST", "PUT"]);
  assert.equal(app.requests[1].token, "coach");
  assert.equal(app.requests[1].plan.student, "Maria");
});

test("preserves edits made while the first publication is in flight", async () => {
  let complete;
  const app = editor({}, { publishPlan: () => new Promise((resolve) => { complete = resolve; }) });
  app.change("Ana");
  await app.save();
  app.change("Maria");
  assert.equal(app.timers.size, 0);
  complete({ id: "plan-1", prescriberToken: "coach", studentToken: "student" });
  await app.flush();
  await app.save();
  assert.deepEqual(app.requests.map(({ method }) => method), ["POST", "PUT"]);
  assert.equal(app.requests[1].plan.student, "Maria");
});

test("a failed save does not loop and can be retried manually", async () => {
  let fail = true;
  const app = editor({}, { publishPlan: () => {
    if (fail) throw new Error("Sin conexion");
    return { id: "plan-1", prescriberToken: "coach", studentToken: "student" };
  } });
  app.change("Ana");
  await app.save();
  assert.equal(app.timers.size, 0);
  fail = false;
  await app.retry();
  assert.equal(app.requests.length, 2);
  assert.equal(app.urls.length, 1);
});

test("autosaving an existing plan preserves student execution", async () => {
  const original = editor();
  original.change("Ana");
  await original.save();
  const app = editor({
    initialPlan: original.plan,
    serverPlan: original.requests[0].plan,
    sharedEditor: true,
    prescriberToken: "coach",
    planId: "plan-1",
    initialExecution: { "1:2:1": { sets: "4" } },
  });
  assert.equal(app.timers.size, 0);
  app.change("Maria");
  await app.save();
  assert.deepEqual(app.requests.map(({ method }) => method), ["PUT"]);
});

test("PDF-only rendering never schedules a save", () => {
  const app = editor({ pdfOnly: true });
  assert.equal(app.timers.size, 0);
  assert.equal(app.requests.length, 0);
});
