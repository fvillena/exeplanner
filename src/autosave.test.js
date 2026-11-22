import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { rolldown } from "rolldown";

const entry = fileURLToPath(new URL("./main.jsx", import.meta.url));
const bundle = await rolldown({
  input: entry,
  external: (id) => id !== entry,
  transform: { jsx: { runtime: "classic" } },
  plugins: [{ name: "test-app", transform: (code) => `${code}\nexport { App as TestApp, ReorderHandle, StudentExerciseDescription };` }],
});
const { output } = await bundle.generate({ format: "cjs" });
const compiled = output[0].code;
await bundle.close();

function editor(props = {}, api = {}, component = "TestApp") {
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
    document: { getElementById: () => ({}), elementFromPoint: () => api.dropTarget },
    window: {
      location: { pathname: "/", origin: "https://example.com", search: "" },
      history: { replaceState: (...args) => urls.push(args[2]) },
      innerHeight: 900, scrollBy() {},
      setTimeout: (callback, delay) => { const id = Symbol(); timers.set(id, { callback, delay }); return id; },
      clearTimeout: (id) => timers.delete(id),
    },
  });
  vm.runInContext(compiled, context);
  const render = () => {
    cursor = 0;
    pendingEffects = [];
    tree = context.exports[component](props);
    pendingEffects.forEach((effect) => effect());
  };
  const find = (predicate, node = tree) => {
    if (!node || typeof node !== "object") return undefined;
    if (predicate(node)) return node;
    return (node.props?.children || []).flat(Infinity).filter(Boolean).map((child) => find(predicate, child)).find(Boolean);
  };
  render();
  return {
    requests, urls, timers, render,
    get plan() { return hooks[0]; },
    find,
    move(kind, index, targetIndex) {
      find((node) => typeof node.type === "function" && node.props.kind === kind && node.props.index === index).props.onMove(index, targetIndex);
      render();
    },
    click(label) {
      const button = find((node) => node.type === "button" && node.props["aria-label"] === label);
      assert.ok(button, `Missing button: ${label}`);
      assert.equal(button.props.disabled, false);
      button.props.onClick();
      render();
    },
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

function reorderPlan() {
  return {
    version: 2, name: "Plan", student: "Ana", studentProfile: {},
    startDate: "2026-11-22", generalNotes: "",
    weeks: [1, 2].map((number) => ({
      id: number + 100, number,
      days: [10, 20, 30].map((id) => ({
        id, name: `Sesion ${id}`,
        exercises: [1, 2, 3].map((index) => ({
          id: id + index, name: `Ejercicio ${id + index}`, type: "strength",
          sets: `${number + index}`, reps: "10", load: `${number * index} kg`,
        })),
      })),
    })),
  };
}

test("session reordering preserves selection, IDs and weekly prescriptions", async () => {
  const initialPlan = reorderPlan();
  const app = editor({ initialPlan });
  app.move("session", 0, 2);
  for (const [index, week] of app.plan.weeks.entries()) {
    assert.deepEqual(Array.from(week.days, (day) => day.id), [20, 30, 10]);
    assert.equal(week.days[2], initialPlan.weeks[index].days[0]);
  }
  assert.equal(app.find((node) => node.props?.className === "title-input").props.value, "Sesion 10");
  await app.save();
  assert.deepEqual(Array.from(app.requests[0].plan.sessions, (session) => session.id), [20, 30, 10]);
  app.move("session", 2, 1);
  assert.deepEqual(Array.from(app.plan.weeks[0].days, (day) => day.id), [20, 10, 30]);
});

test("exercise reordering affects only its session across all weeks and persists order", async () => {
  const initialPlan = reorderPlan();
  const app = editor({ initialPlan });
  app.move("exercise", 0, 2);
  for (const [index, week] of app.plan.weeks.entries()) {
    assert.deepEqual(Array.from(week.days[0].exercises, (exercise) => exercise.id), [12, 13, 11]);
    assert.equal(week.days[0].exercises[2], initialPlan.weeks[index].days[0].exercises[0]);
    assert.equal(week.days[1], initialPlan.weeks[index].days[1]);
  }
  assert.equal(app.find((node) => node.props?.className === "selected-exercise-name").props.value, "Ejercicio 11");
  await app.save();
  const exercises = app.requests[0].plan.sessions[0].exercises;
  assert.deepEqual(Array.from(exercises, (exercise) => exercise.id), [12, 13, 11]);
  assert.deepEqual(Array.from(exercises, (exercise) => exercise.order), [1, 2, 3]);
  assert.deepEqual(Array.from(exercises[2].plan, (item) => item.load), ["1 kg", "2 kg"]);
  app.move("exercise", 2, 1);
  assert.deepEqual(Array.from(app.plan.weeks[0].days[0].exercises, (exercise) => exercise.id), [12, 11, 13]);
});

test("single-item lists disable the drag handle", () => {
  const app = editor({ kind: "session", index: 0, count: 1, name: "Sesion" }, {}, "ReorderHandle");
  assert.equal(app.find((node) => node.type === "button").props.disabled, true);
});

test("reordering a saved plan does not reset student execution", async () => {
  const original = editor({ initialPlan: reorderPlan() });
  original.change("Maria");
  await original.save();
  const app = editor({
    initialPlan: original.plan, serverPlan: original.requests[0].plan,
    sharedEditor: true, prescriberToken: "coach", planId: "plan-1",
    initialExecution: { "1:10:11": { sets: "4" } },
  });
  app.move("session", 0, 1);
  app.move("exercise", 0, 1);
  await app.save();
  assert.deepEqual(app.requests.map(({ method }) => method), ["PUT"]);
  const session = app.requests[0].plan.sessions.find((item) => item.id === 10);
  assert.deepEqual(Array.from(session.exercises, (exercise) => exercise.id), [12, 11, 13]);
});

test("dragging an unselected item preserves the current selection", () => {
  const app = editor({ initialPlan: reorderPlan() });
  app.move("session", 2, 0);
  app.move("exercise", 2, 0);
  assert.equal(app.find((node) => node.props?.className === "title-input").props.value, "Sesion 10");
  assert.equal(app.find((node) => node.props?.className === "selected-exercise-name").props.value, "Ejercicio 11");
});

test("drag handles support keyboard reordering and respect boundaries", () => {
  for (const [kind, key] of [["session", "ArrowRight"], ["exercise", "ArrowDown"]]) {
    const moves = [];
    const app = editor({ kind, index: 0, count: 3, name: "Item", onMove: (...args) => moves.push(args) }, {}, "ReorderHandle");
    const button = app.find((node) => node.type === "button");
    button.props.onKeyDown({ key, preventDefault() {} });
    button.props.onKeyDown({ key: kind === "session" ? "ArrowLeft" : "ArrowUp", preventDefault() {} });
    assert.deepEqual(moves, [[0, 1]]);
  }
});

test("pointer dragging commits only on drop and cancellation leaves order unchanged", () => {
  const moves = [];
  const list = {};
  const target = { parentElement: list, dataset: { reorderKind: "exercise", reorderIndex: "2" }, classList: { add() {}, remove() {} } };
  const app = editor({ kind: "exercise", index: 0, count: 3, name: "Item", onMove: (...args) => moves.push(args) }, { dropTarget: { closest: () => target } }, "ReorderHandle");
  const button = app.find((node) => node.type === "button");
  const start = { button: 0, isPrimary: true, clientX: 10, clientY: 10, pointerId: 1,
    currentTarget: { closest: () => ({ parentElement: list }), setPointerCapture() {} } };
  button.props.onPointerDown(start);
  button.props.onPointerMove({ clientX: 10, clientY: 150 });
  assert.deepEqual(moves, []);
  button.props.onPointerUp();
  assert.deepEqual(moves, [[0, 2]]);
  button.props.onPointerDown(start);
  button.props.onPointerMove({ clientX: 10, clientY: 150 });
  button.props.onPointerCancel();
  button.props.onPointerUp();
  assert.deepEqual(moves, [[0, 2]]);
});

test("long student descriptions can expand and collapse without losing their links", () => {
  const example = JSON.parse(readFileSync(new URL("../example2.json", import.meta.url), "utf8"));
  const description = example.sessions[0].exercises[0].description;
  assert.ok(description.length > 1500);
  const app = editor({ description }, {}, "StudentExerciseDescription");
  const toggle = () => app.find((node) => node.type === "button");
  const displayed = () => app.find((node) => typeof node.type === "function").props.children[0];
  assert.equal(toggle().props["aria-expanded"], false);
  assert.ok(displayed().length <= 183);
  assert.ok(displayed().endsWith("..."));
  toggle().props.onClick();
  app.render();
  assert.equal(toggle().props["aria-expanded"], true);
  assert.equal(displayed(), description);
  assert.ok(displayed().includes("https://www.mayoclinic.org/"));
  toggle().props.onClick();
  app.render();
  assert.equal(toggle().props["aria-expanded"], false);
  assert.ok(displayed().length <= 183);
});

test("short and empty descriptions do not offer expansion", () => {
  for (const description of [undefined, "", "Una descripcion breve.", "a".repeat(180)]) {
    const app = editor({ description }, {}, "StudentExerciseDescription");
    assert.equal(app.find((node) => node.type === "button"), undefined);
    if (description) {
      assert.equal(app.find((node) => typeof node.type === "function").props.children[0], description);
    }
  }
});
