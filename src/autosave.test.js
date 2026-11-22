import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { rolldown } from "rolldown";
import * as exerciseLibrary from "./exercise-library.js";

const entry = fileURLToPath(new URL("./main.jsx", import.meta.url));
const bundle = await rolldown({
  input: entry,
  external: (id) => id !== entry,
  transform: { jsx: { runtime: "classic" } },
   plugins: [{ name: "test-app", transform: (code) => `${code}\nexport { App as TestApp, ReorderHandle, StudentExerciseDescription, ExerciseLibrary, ExerciseAnimation };` }],
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
     "./exercise-library.js": { ...exerciseLibrary, loadExerciseLibrary: api.loadExerciseLibrary || exerciseLibrary.loadExerciseLibrary },
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

test("library open and cancellation leave the plan untouched", async () => {
  const app = editor();
  const before = app.plan;
  app.find((node) => node.type === "button" && node.props.children.includes(" Añadir desde biblioteca")).props.onClick();
  app.render();
  const library = app.find((node) => typeof node.type === "function" && node.props.modal === true);
  assert.ok(library.props.modal);
  library.props.onClose();
  app.render();
  assert.equal(app.plan, before);
  await app.save();
  assert.equal(app.requests.length, 0);
});

test("library adds independent editable copies with local IDs across weeks and saves normally", async () => {
  const initialPlan = reorderPlan();
  const app = editor({ initialPlan });
  const record = { id: "0011", name: "Running", description: "Corre de forma controlada.", category: "cardio", gif_path: "videos/0011-example.gif" };
  const add = () => {
    app.find((node) => node.type === "button" && node.props.children.includes(" Añadir desde biblioteca")).props.onClick();
    app.render();
    app.find((node) => typeof node.type === "function" && node.props.modal === true).props.onAdd(record);
    app.render();
  };
  add();
  const firstId = app.plan.weeks[0].days[0].exercises[3].id;
  assert.ok(Number.isInteger(firstId) && firstId > 102);
  assert.equal(app.plan.weeks[1].days[0].exercises[3].id, firstId);
  assert.notEqual(app.plan.weeks[0].days[0].exercises[3], app.plan.weeks[1].days[0].exercises[3]);
  for (const [index, week] of app.plan.weeks.entries()) {
    assert.equal(week.days[1], initialPlan.weeks[index].days[1]);
    assert.equal(week.days[0].exercises[0], initialPlan.weeks[index].days[0].exercises[0]);
    assert.equal(week.days[0].exercises[3].type, "cardio");
    assert.equal(week.days[0].exercises[3].sets, "");
  }
  add();
  assert.notEqual(app.plan.weeks[0].days[0].exercises[4].id, firstId);
  assert.equal(app.requests.length, 0);
  assert.ok([...app.timers.values()].some(({ delay }) => delay === 800));
  app.find((node) => node.type === "input" && node.props.className === "selected-exercise-name").props.onChange({ target: { value: "Carrera" } });
  app.render();
  await app.save();
  assert.deepEqual(app.requests.map(({ method }) => method), ["POST"]);
  const saved = app.requests[0].plan.sessions[0].exercises[4];
  assert.equal(saved.name, "Carrera");
  assert.equal(saved.description, record.description);
  assert.equal(saved.type, "cardio");
  assert.equal(saved.gif_path, undefined);
  assert.equal(saved.plan.length, 2);
});

test("manual exercise creation still uses defaults rather than the click event", () => {
  const app = editor();
  app.find((node) => node.type === "button" && node.props.children.includes(" Añadir ejercicio")).props.onClick({ type: "click" });
  app.render();
  assert.equal(app.plan.weeks[0].days[0].exercises[1].name, "Nuevo ejercicio");
  assert.equal(app.plan.weeks[0].days[0].exercises[1].type, "strength");
});

test("library filtering handles accents, Spanish instructions and combined filters", () => {
  const records = [
    { id: "1", name: "Barbell curl", description: "Flexión de brazos", category: "upper arms", equipment: "barbell", target: "biceps" },
    { id: "2", name: "Running", description: "Corre", category: "cardio", equipment: "body weight", target: "cardio" },
  ];
  assert.equal(exerciseLibrary.filterLibrary(records, "FLEXION BARRA", "upper arms", "barbell")[0], records[0]);
  assert.equal(exerciseLibrary.filterLibrary(records, "running", "", "")[0], records[1]);
  assert.equal(exerciseLibrary.filterLibrary(records, "", "cardio", "barbell").length, 0);
  assert.equal(exerciseLibrary.libraryLabel("unknown"), "unknown");
});

test("target filter includes glutes, combines filters and clears without changing the plan", async () => {
  const records = JSON.parse(readFileSync(new URL("./data/exercises.json", import.meta.url), "utf8"));
  const glutes = exerciseLibrary.filterLibrary(records, "", "", "", "glutes");
  assert.ok(glutes.length > 30);
  assert.ok(glutes.every((record) => record.target === "glutes"));
  const searchResults = exerciseLibrary.filterLibrary(records, "GLUTEOS", "", "");
  assert.ok(glutes.every((record) => searchResults.includes(record)));
  assert.ok(exerciseLibrary.filterLibrary(records, "", "upper arms", "", "glutes").length === 0);
  const app = editor({ sessionName: "Sesión", onAdd() { assert.fail("Filtering must not add exercises"); } }, {
    loadExerciseLibrary: async () => records,
  }, "ExerciseLibrary");
  await app.flush();
  assert.ok(app.find((node) => node.type === "option" && node.props.value === "glutes" && node.props.children.includes("Glúteos")));
  const targetSelect = () => app.find((node) => node.type === "label" && node.props.children.includes("Músculo objetivo")).props.children.find((node) => node?.type === "select");
  app.find((node) => node.type === "button" && node.props.children.includes("Siguiente")).props.onClick();
  app.render();
  targetSelect().props.onChange({ target: { value: "glutes" } });
  app.render();
  assert.equal(targetSelect().props.value, "glutes");
  assert.equal(app.find((node) => node.type === "button" && node.props.children.includes("Anterior")).props.disabled, true);
  app.find((node) => node.type === "button" && node.props.children.includes("Limpiar filtros")).props.onClick();
  app.render();
  assert.equal(targetSelect().props.value, "");
  assert.equal(app.requests.length, 0);
});

test("body region selector includes all 10 catalog categories and preserves options when combined", async () => {
  const records = JSON.parse(readFileSync(new URL("./data/exercises.json", import.meta.url), "utf8"));
  const categories = [...new Set(records.map((record) => record.category))].sort();
  assert.deepEqual(categories, ["back", "cardio", "chest", "lower arms", "lower legs", "neck", "shoulders", "upper arms", "upper legs", "waist"]);
  const app = editor({ sessionName: "Sesión", onAdd() { assert.fail("Filtering must not add exercises"); } }, {
    loadExerciseLibrary: async () => records,
  }, "ExerciseLibrary");
  await app.flush();
  const select = (label) => app.find((node) => node.type === "label" && node.props.children.includes(label)).props.children.find((node) => node?.type === "select");
  for (const category of categories) {
    const label = exerciseLibrary.libraryLabel(category);
    assert.notEqual(label, category);
    assert.ok(app.find((node) => node.type === "option" && node.props.value === category && node.props.children.includes(label), select("Zona corporal")));
    const expected = records.filter((record) => record.category === category);
    assert.deepEqual(exerciseLibrary.filterLibrary(records, "", category, ""), expected);
    const sample = expected[0];
    const combined = exerciseLibrary.filterLibrary(records, "", category, sample.equipment, sample.target);
    assert.ok(combined.includes(sample));
    assert.ok(combined.every((record) => record.category === category && record.equipment === sample.equipment && record.target === sample.target));
  }
  select("Músculo objetivo").props.onChange({ target: { value: "glutes" } });
  app.render();
  for (const category of categories) {
    assert.ok(app.find((node) => node.type === "option" && node.props.value === category, select("Zona corporal")));
  }
  select("Zona corporal").props.onChange({ target: { value: "upper legs" } });
  app.render();
  assert.equal(select("Zona corporal").props.value, "upper legs");
  app.find((node) => node.type === "button" && node.props.children.includes("Limpiar filtros")).props.onClick();
  app.render();
  assert.equal(select("Zona corporal").props.value, "");
  assert.equal(select("Músculo objetivo").props.value, "");
  assert.equal(app.requests.length, 0);
});

test("equipment selector includes all 28 catalog values, translated and filterable", async () => {
  const records = JSON.parse(readFileSync(new URL("./data/exercises.json", import.meta.url), "utf8"));
  const values = [...new Set(records.map((record) => record.equipment))];
  assert.equal(values.length, 28);
  const app = editor({ sessionName: "Sesión", onAdd() {} }, {
    loadExerciseLibrary: async () => records,
  }, "ExerciseLibrary");
  await app.flush();
  const select = () => app.find((node) => node.type === "label" && node.props.children.includes("Equipamiento")).props.children.find((node) => node?.type === "select");
  for (const equipment of values) {
    const label = exerciseLibrary.libraryLabel(equipment);
    assert.notEqual(label, equipment);
    assert.ok(app.find((node) => node.type === "option" && node.props.value === equipment && node.props.children.includes(label), select()));
    const expected = records.filter((record) => record.equipment === equipment);
    assert.deepEqual(exerciseLibrary.filterLibrary(records, "", "", equipment), expected);
    const sample = expected[0];
    const combined = exerciseLibrary.filterLibrary(records, "", sample.category, equipment, sample.target);
    assert.ok(combined.includes(sample));
    assert.ok(combined.every((record) => record.category === sample.category && record.equipment === equipment && record.target === sample.target));
  }
  select().props.onChange({ target: { value: "kettlebell" } });
  app.render();
  assert.equal(select().props.value, "kettlebell");
  app.find((node) => node.type === "button" && node.props.children.includes("Limpiar filtros")).props.onClick();
  app.render();
  assert.equal(select().props.value, "");
});

test("library load failure offers a working retry and filters reset pagination", async () => {
  let calls = 0;
  const records = Array.from({ length: 31 }, (_, index) => ({ id: `${index}`, name: `Curl ${index}`, description: "Flexión", category: "upper arms", equipment: "barbell", target: "biceps" }));
  const app = editor({ sessionName: "Sesión 1", onAdd() {} }, {
    loadExerciseLibrary: async () => { if (++calls === 1) throw new Error("offline"); return records; },
  }, "ExerciseLibrary");
  await app.flush();
  assert.ok(app.find((node) => node.props?.role === "alert"));
  app.find((node) => node.type === "button" && node.props.children.includes("Reintentar")).props.onClick();
  app.render();
  await app.flush();
  assert.equal(calls, 2);
  assert.equal(app.find((node) => node.props?.role === "alert"), undefined);
  const scrolls = [];
  app.find((node) => node.props?.className === "library-heading").props.ref.current = {
    scrollIntoView: (options) => scrolls.push(options),
  };
  app.find((node) => node.type === "button" && node.props.children.includes("Siguiente")).props.onClick();
  app.render();
  assert.equal(scrolls.length, 1);
  assert.equal(scrolls[0].block, "start");
  assert.ok(app.find((node) => node.type === "h3" && node.props.children.includes("Curl 30")));
  app.find((node) => node.type === "input").props.onChange({ target: { value: "Curl 0" } });
  app.render();
  assert.ok(app.find((node) => node.type === "h3" && node.props.children.includes("Curl 0")));
});

test("catalog is complete and contains Spanish instructions and safe GIF references", () => {
  const records = JSON.parse(readFileSync(new URL("./data/exercises.json", import.meta.url), "utf8"));
  assert.equal(records.length, 1324);
  assert.equal(new Set(records.map(({ id }) => id)).size, records.length);
  for (const record of records) {
    assert.deepEqual(Object.keys(record).sort(), ["category", "description", "equipment", "gif_path", "id", "name", "target"]);
    assert.ok(Object.values(record).every((value) => typeof value === "string" && value.trim()));
    assert.match(record.id, /^\d{4}$/);
    assert.match(record.gif_path, /^videos\/[A-Za-z0-9_-]+\.gif$/);
    assert.equal(exerciseLibrary.exerciseGifUrl(record), `/exercise-media/${record.gif_path}`);
    const gif = readFileSync(new URL(`../public/exercise-media/${record.gif_path}`, import.meta.url));
    assert.match(gif.subarray(0, 6).toString("ascii"), /^GIF8[79]a$/);
  }
  const license = readFileSync(new URL("./data/exercises.LICENSE.txt", import.meta.url), "utf8");
  assert.ok(license.includes("MIT License") && license.includes("MEDIA EXCEPTION"));
});

test("GIF preview is always shown with native lazy loading and handles retry", () => {
  const record = { name: "Curl", gif_path: "videos/0001-example.gif" };
  const app = editor({ record }, {}, "ExerciseAnimation");
  const image = app.find((node) => node.type === "img");
  assert.equal(image.props.src, exerciseLibrary.exerciseGifUrl(record));
  assert.equal(image.props.loading, "lazy");
  assert.equal(image.props.decoding, "async");
  assert.equal(image.props.width, "180");
  assert.equal(image.props.height, "180");
  assert.equal(app.find((node) => node.type === "button"), undefined);
  assert.ok(app.find((node) => node.type === "figcaption"));
  image.props.onError();
  app.render();
  assert.equal(app.find((node) => node.type === "img"), undefined);
  assert.ok(app.find((node) => node.props?.role === "status"));
  app.find((node) => node.type === "button" && node.props.children.includes("Reintentar animación")).props.onClick();
  app.render();
  assert.ok(app.find((node) => node.type === "img"));
});

test("GIF preview rejects missing, external and traversal paths", () => {
  for (const gif_path of [undefined, "https://other.example/a.gif", "videos/../a.gif", "videos/a.svg"]) {
    const record = { name: "Curl", gif_path };
    assert.equal(exerciseLibrary.exerciseGifUrl(record), "");
    const app = editor({ record }, {}, "ExerciseAnimation");
    assert.equal(app.find((node) => node.type === "img"), undefined);
    assert.equal(app.find((node) => node.type === "button"), undefined);
  }
});

test("catalog loader is lazy, shares requests, retries failures and caches success", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const catalog = [{ id: "1", name: "Curl", category: "upper arms", equipment: "barbell", target: "biceps", description: "Flexiona los brazos." }];
  try {
    globalThis.fetch = async () => {
      calls++;
      if (calls === 1) return { ok: false };
      if (calls === 2) return { ok: true, json: async () => ({ invalid: true }) };
      return { ok: true, json: async () => catalog };
    };
    const library = await import(`./exercise-library.js?loader-test`);
    assert.equal(calls, 0);
    const first = library.loadExerciseLibrary();
    assert.equal(first, library.loadExerciseLibrary());
    await assert.rejects(first, /cargar/);
    await assert.rejects(library.loadExerciseLibrary(), /formato/);
    assert.equal(await library.loadExerciseLibrary(), catalog);
    assert.equal(await library.loadExerciseLibrary(), catalog);
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
