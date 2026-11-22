export const libraryLicenseUrl = new URL("./data/exercises.LICENSE.txt?no-inline", import.meta.url).href;
const catalogUrl = new URL("./data/exercises.json", import.meta.url).href;
let catalogPromise;
const mediaBaseUrl = "/exercise-media/";
export const exerciseGifUrl = (record) => /^videos\/[A-Za-z0-9_-]+\.gif$/.test(record.gif_path || "")
  ? `${mediaBaseUrl}${record.gif_path}` : "";

export function loadExerciseLibrary() {
  if (!catalogPromise) {
    catalogPromise = fetch(catalogUrl).then(async (response) => {
      if (!response.ok) throw new Error("No se pudo cargar la biblioteca.");
      const records = await response.json();
      if (!Array.isArray(records) || !records.length || records.some((record) =>
        !record || ["id", "name", "category", "equipment", "target", "description"].some((field) => typeof record[field] !== "string"))) {
        throw new Error("El catálogo no tiene un formato válido.");
      }
      return records;
    }).catch((error) => {
      catalogPromise = undefined;
      throw error;
    });
  }
  return catalogPromise;
}

const labels = {
  back: "Espalda", cardio: "Cardio", chest: "Pecho", "lower arms": "Antebrazos",
  "lower legs": "Pantorrillas", neck: "Cuello", shoulders: "Hombros",
  "upper arms": "Brazos", "upper legs": "Piernas", waist: "Abdomen",
  "body weight": "Peso corporal", dumbbell: "Mancuerna", cable: "Polea", barbell: "Barra",
  "leverage machine": "Máquina de palanca", band: "Banda elástica", "smith machine": "Máquina Smith",
  kettlebell: "Pesa rusa", weighted: "Con lastre", "stability ball": "Pelota de estabilidad",
  "ez barbell": "Barra EZ", assisted: "Asistido", "medicine ball": "Balón medicinal",
  "resistance band": "Banda de resistencia", roller: "Rodillo", rope: "Cuerda",
  "olympic barbell": "Barra olímpica", "trap bar": "Barra hexagonal", "bosu ball": "Bosu",
  "sled machine": "Trineo", "upper body ergometer": "Ergómetro de brazos",
  "skierg machine": "Máquina de esquí", "elliptical machine": "Elíptica",
  "stationary bike": "Bicicleta estática", "stepmill machine": "Escaladora",
  tire: "Neumático", hammer: "Martillo", "wheel roller": "Rueda abdominal",
  abductors: "Abductores", abs: "Abdominales", adductors: "Aductores", biceps: "Bíceps",
  calves: "Gemelos", "cardiovascular system": "Sistema cardiovascular", delts: "Deltoides",
  forearms: "Antebrazos", glutes: "Glúteos", hamstrings: "Isquiotibiales", lats: "Dorsales",
  "levator scapulae": "Elevador de la escápula", pectorals: "Pectorales", quads: "Cuádriceps",
  "serratus anterior": "Serrato anterior", spine: "Erectores espinales", traps: "Trapecios",
  triceps: "Tríceps", "upper back": "Espalda alta",
};
export const libraryLabel = (value) => labels[value] || value;
const searchable = (value) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export function filterLibrary(records, query, category, equipment, target = "") {
  const terms = searchable(query).trim().split(/\s+/).filter(Boolean);
  return records.filter((record) => (!category || record.category === category)
    && (!equipment || record.equipment === equipment)
    && (!target || record.target === target)
    && terms.every((term) => searchable([
      record.name, record.description, record.target, record.category, record.equipment,
      libraryLabel(record.category), libraryLabel(record.equipment), libraryLabel(record.target),
    ].join(" ")).includes(term)));
}
