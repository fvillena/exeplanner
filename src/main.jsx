import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { jsPDF } from "jspdf";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Copy,
  Dumbbell,
  FileText,
  Flame,
  GripVertical,
  Plus,
  Search,
  Settings2,
  Trash2,
  UserRound,
} from "lucide-react";
import "./styles.css";

// Persistencia desactivada temporalmente. Para reactivarla, descomenta los bloques marcados.
const STORAGE_KEY = "exeplanner-plan-v2";
let nextEntityId = 0;
const makeId = () => ++nextEntityId;
const getBmiInterpretation = (value) => {
  if (!value) return "";
  return Number(value) < 18.5
    ? "Bajo peso"
    : Number(value) < 25
      ? "Normal"
      : Number(value) < 30
        ? "Sobrepeso"
        : "Obesidad";
};
const syncNextEntityId = (value) => {
  const ids = [
    ...value.weeks.flatMap((week) => [
      week.id,
      ...week.days.flatMap((day) => [
        day.id,
        ...day.exercises.map((exercise) => exercise.id),
      ]),
    ]),
  ].filter(Number.isInteger);
  nextEntityId = Math.max(nextEntityId, ...ids, 0);
};
const makeExercise = (name = "Nuevo ejercicio", type = "strength") => ({
  id: makeId(),
  name,
  description: "",
  type,
  sets: "",
  reps: "",
  load: "",
  rest: "60",
  metric: "",
  intensity: "",
  notes: "",
});
const makeDay = (number, name = `Día ${number}`) => ({
  id: makeId(),
  name,
  exercises: [makeExercise()],
});
const makeWeek = (number, days = 3) => ({
  id: makeId(),
  number,
  days: Array.from({ length: days }, (_, i) => makeDay(i + 1)),
});
const cloneWeekContent = (source, target) => ({
  ...target,
  days: source.days.map((day) => ({
    ...day,
    exercises: day.exercises.map((exercise) => ({
      ...exercise,
    })),
  })),
});
const firstWeek = makeWeek(1, 1);
const initialPlan = {
  version: 2,
  name: "",
  student: "",
  studentProfile: {
    age: "",
    sex: "",
    weight: "",
    height: "",
    bodyFat: "",
    injuries: "",
    medicalNotes: "",
    caseDescription: "",
    goal: "",
  },
  startDate: new Date().toISOString().slice(0, 10),
  generalNotes: "",
  weeks: [firstWeek],
};
const normalizePlan = (value) => {
  const sessions = value.sessions;
  const weekNumbers = Array.from(
    new Set(
      sessions.flatMap((session) =>
        session.exercises.flatMap((exercise) =>
          (exercise.plan || []).map((item) => Number(item.week)),
        ),
      ),
    ),
  ).filter(Boolean).sort((a, b) => a - b);
  const weeks = (weekNumbers.length ? weekNumbers : [1]).map((number) => ({
    id: makeId(),
    number,
    days: sessions.map((session, sessionIndex) => {
      return {
        id: session.id,
        name: session.name || `Sesión ${sessionIndex + 1}`,
        exercises: session.exercises.map((definition) => ({
          ...definition,
          ...(definition.plan?.find((item) => Number(item.week) === number) || {}),
          id: definition.id,
          name: definition.name || "Nuevo ejercicio",
          type: definition.type || "strength",
        })),
      };
    }),
  }));
  return {
    ...value,
    version: 2,
    studentProfile: {
      age: "",
      sex: "",
      weight: "",
      height: "",
      bodyFat: "",
      injuries: "",
      medicalNotes: "",
      caseDescription: "",
      goal: "",
      ...(value.studentProfile || {}),
    },
    weeks,
  };
};
const toSchemaPlan = (value) => {
  const firstWeek = value.weeks[0];
  const sessions = (firstWeek?.days || []).map((day, dayIndex) => ({
    id: day.id,
    name: day.name || `Sesión ${dayIndex + 1}`,
    exercises: day.exercises.map((exercise, exerciseIndex) => ({
      id: exercise.id,
      name: exercise.name,
      description: exercise.description || "",
      type: exercise.type || "strength",
      order: exerciseIndex + 1,
      plan: value.weeks.map((week) => {
        const weeklyExercise = week.days
          .find((item) => item.id === day.id)
          ?.exercises.find((item) => item.id === exercise.id) || {};
        return {
          week: week.number,
          sets: weeklyExercise.sets || "",
          reps: weeklyExercise.reps || "",
          load: weeklyExercise.load || "",
          rest: weeklyExercise.rest || "",
          metric: weeklyExercise.metric || "",
          intensity: weeklyExercise.intensity || "",
          ...(weeklyExercise.notes ? { notes: weeklyExercise.notes } : {}),
        };
      }),
    })),
  }));
  return {
    version: 2,
    name: value.name || "",
    student: value.student || "",
    studentProfile: value.studentProfile,
    startDate: value.startDate || "",
    generalNotes: value.generalNotes || "",
    sessions,
  };
};

function App() {
  const [plan, setPlan] = useState(initialPlan);
  const [weekIndex, setWeekIndex] = useState(0);
  const [activeDay, setActiveDay] = useState(0);
  const [activeExercise, setActiveExercise] = useState(0);
  const [highlightedWeek, setHighlightedWeek] = useState(null);
  const [highlightedSummaryCell, setHighlightedSummaryCell] = useState(null);
  const [tab, setTab] = useState("plan");
  const [copyStatus, setCopyStatus] = useState("");
  const importRef = useRef(null);
  const week = plan.weeks[weekIndex];
  const day = week?.days[activeDay];
  const selectedExercise = day?.exercises[activeExercise];
  const comparisonDays = Array.from(
    {
      length: Math.max(0, ...plan.weeks.map((item) => item.days?.length || 0)),
    },
    (_, index) => plan.weeks.find((item) => item.days?.[index])?.days[index],
  ).filter(Boolean);
  const comparisonRows = comparisonDays.map((_, dayIndex) => {
    const rows = [];
    plan.weeks.forEach((item) =>
      item.days?.[dayIndex]?.exercises?.forEach((exercise) => {
        const key = exercise.name.trim().toLowerCase();
        if (key && !rows.some((row) => row.key === key))
          rows.push({
            key,
            name: exercise.name,
            description: exercise.description || "",
          });
      }),
    );
    return rows;
  });

  // Reactivar localStorage cuando se necesite:
  // useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(plan)); }, [plan]);
  useEffect(() => {
    if (activeDay >= (week?.days.length || 1)) setActiveDay(0);
  }, [weekIndex, week?.days.length, activeDay]);
  // Limpia cualquier planificación anterior mientras la persistencia está desactivada.
  useEffect(() => {
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const updatePlan = (patch) => setPlan((p) => ({ ...p, ...patch }));
  const updateStudentProfile = (patch) =>
    setPlan((p) => ({
      ...p,
      studentProfile: { ...p.studentProfile, ...patch },
    }));
  const copyPatientData = async () => {
    const profile = plan.studentProfile || {};
    const text = [
      "## Perfil del paciente",
      "",
      `- **Nombre:** ${plan.student || "Sin especificar"}`,
      `- **Edad:** ${profile.age ? `${profile.age} años` : "Sin especificar"}`,
      `- **Sexo:** ${profile.sex || "Sin especificar"}`,
      `- **Peso:** ${profile.weight ? `${profile.weight} kg` : "Sin especificar"}`,
      `- **Talla:** ${profile.height ? `${profile.height} cm` : "Sin especificar"}`,
      `- **IMC:** ${bmi || "Sin especificar"}`,
      `- **Grasa corporal:** ${profile.bodyFat ? `${profile.bodyFat}%` : "Sin especificar"}`,
      "",
      "### Descripción del caso",
      profile.caseDescription || "Sin especificar",
      "### Objetivo principal",
      profile.goal || "Sin especificar",
      "",
      "### Lesiones o limitaciones",
      profile.injuries || "Sin especificar",
      "",
      "### Antecedentes / notas de salud",
      profile.medicalNotes || "Sin especificar",
    ].join("\n");

    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus("Copiado");
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
      setCopyStatus("Copiado");
    }
    setTimeout(() => setCopyStatus(""), 2200);
  };
  const bmi =
    Number(plan.studentProfile?.weight) > 0 &&
      Number(plan.studentProfile?.height) > 0
      ? (
        Number(plan.studentProfile.weight) /
        (Number(plan.studentProfile.height) / 100) ** 2
      ).toFixed(1)
      : "";
  const bmiInterpretation = bmi
    ? getBmiInterpretation(bmi)
    : "";
  const setDuration = (value) => {
    const count = Math.max(1, Math.min(52, Number(value) || 1));
    setPlan((p) => ({
      ...p,
      weeks: Array.from(
        { length: count },
        (_, index) =>
          p.weeks[index] ||
          cloneWeekContent(
            p.weeks[0],
            makeWeek(index + 1, p.weeks[0].days.length),
          ),
      ).map((week, index) => ({ ...week, number: index + 1 })),
    }));
    setWeekIndex((index) => Math.min(index, count - 1));
  };
  const updateDay = (patch) =>
    setPlan((p) => ({
      ...p,
      weeks: p.weeks.map((item, index) =>
        index === weekIndex
          ? {
            ...item,
            days: item.days.map((itemDay, dayIndex) =>
              dayIndex === activeDay ? { ...itemDay, ...patch } : itemDay,
            ),
          }
          : item,
      ),
    }));
  const updateExercise = (id, patch) =>
    updateDay({
      exercises: day.exercises.map((exercise) =>
        exercise.id === id ? { ...exercise, ...patch } : exercise,
      ),
    });
  const removeExercise = (id) =>
    updateDay({ exercises: day.exercises.filter((exercise) => exercise.id !== id) });
  const editExerciseFromSummary = (targetWeek, targetDay, exerciseId) => {
    setWeekIndex(targetWeek);
    setActiveDay(targetDay);
    const targetExerciseIndex =
      plan.weeks[targetWeek]?.days?.[targetDay]?.exercises?.findIndex(
        (exercise) => exercise.id === exerciseId,
      ) ?? 0;
    setActiveExercise(Math.max(0, targetExerciseIndex));
    setHighlightedWeek(plan.weeks[targetWeek]?.number ?? null);
    setTab("plan");
    setTimeout(() => {
      document.getElementById("plan-structure")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
    window.setTimeout(() => setHighlightedWeek(null), 1800);
  };
  const goToSummaryCell = (dayIndex, weekIndex, exerciseId) => {
    const cellId = `summary-cell-${dayIndex}-${weekIndex}-${exerciseId}`;
    setHighlightedSummaryCell(cellId);
    document.getElementById(cellId)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    window.setTimeout(() => setHighlightedSummaryCell(null), 1800);
  };
  const exerciseDetails = (exercise) => {
    if (!exercise) return [];
    if (exercise.type === "cardio") {
      return [
        exercise.metric,
        // Read older imported files while new exercises use the single metric field.
        !exercise.metric && exercise.duration,
        !exercise.metric && exercise.distance,
        exercise.intensity,
      ].filter(Boolean);
    }
    if (exercise.type === "mobility") {
      return [
        exercise.metric,
        !exercise.metric && exercise.duration,
        exercise.intensity,
      ].filter(Boolean);
    }
    return [
      `${exercise.sets || "-"} x ${exercise.reps || "-"}`,
      exercise.load && `Carga: ${exercise.load}`,
      exercise.rest && `Descanso: ${exercise.rest} s`,
    ].filter(Boolean);
  };
  const addDay = () => {
    const newDay = makeDay(week.days.length + 1, `Sesión ${week.days.length + 1}`);
    setPlan((p) => ({
      ...p,
      weeks: p.weeks.map((item) => ({
        ...item,
        days: [
          ...item.days,
          { ...newDay, exercises: newDay.exercises.map((exercise) => ({ ...exercise })) },
        ],
      })),
    }));
    setActiveDay(week.days.length);
    setActiveExercise(0);
  };
  const updateSessionStructure = (patch) =>
    setPlan((p) => ({
      ...p,
      weeks: p.weeks.map((item) => ({
        ...item,
        days: item.days.map((itemDay, index) =>
          index === activeDay ? { ...itemDay, ...patch } : itemDay,
        ),
      })),
    }));
  const updateExerciseStructure = (patch) =>
    setPlan((p) => ({
      ...p,
      weeks: p.weeks.map((item) => ({
        ...item,
        days: item.days.map((itemDay, dayIndex) =>
          dayIndex === activeDay
            ? {
              ...itemDay,
              exercises: itemDay.exercises.map((exercise, exerciseIndex) =>
                exerciseIndex === activeExercise
                  ? { ...exercise, ...patch }
                  : exercise,
              ),
            }
            : itemDay,
        ),
      })),
    }));
  const updateExercisePrescription = (weekNumber, patch) => {
    const { notes, ...progressionPatch } = patch;
    const onlyNotes = notes !== undefined && !Object.keys(progressionPatch).length;
    setPlan((p) => ({
      ...p,
      weeks: p.weeks.map((item) => {
        if (item.number < weekNumber || (onlyNotes && item.number > weekNumber))
          return item;
        return {
          ...item,
          days: item.days.map((itemDay, dayIndex) =>
            dayIndex === activeDay
              ? {
                ...itemDay,
                exercises: itemDay.exercises.map(
                  (exercise, exerciseIndex) =>
                    exerciseIndex === activeExercise
                      ? {
                        ...exercise,
                        ...progressionPatch,
                        ...(notes !== undefined ? { notes } : {}),
                      }
                      : exercise,
                ),
              }
              : itemDay,
          ),
        };
      }),
    }));
  };
  const addExerciseToSession = () => {
    const exercise = makeExercise();
    setPlan((p) => ({
      ...p,
      weeks: p.weeks.map((item) => ({
        ...item,
        days: item.days.map((itemDay, index) =>
          index === activeDay
            ? { ...itemDay, exercises: [...itemDay.exercises, { ...exercise }] }
            : itemDay,
        ),
      })),
    }));
    setActiveExercise(day?.exercises.length || 0);
  };
  const removeExerciseFromSession = () => {
    if (!selectedExercise || (day?.exercises.length || 0) <= 1) return;
    setPlan((p) => ({
      ...p,
      weeks: p.weeks.map((item) => ({
        ...item,
        days: item.days.map((itemDay, dayIndex) =>
          dayIndex === activeDay
            ? {
              ...itemDay,
              exercises: itemDay.exercises.filter(
                (_, exerciseIndex) => exerciseIndex !== activeExercise,
              ),
            }
            : itemDay,
        ),
      })),
    }));
    setActiveExercise((index) => Math.max(0, index - 1));
  };
  const getWeekExercise = (targetWeek, exerciseIndex = activeExercise) =>
    targetWeek?.days?.[activeDay]?.exercises?.[exerciseIndex] || {};
  const exportPlan = () => {
    const blob = new Blob([JSON.stringify(toSchemaPlan(plan), null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${plan.name.toLowerCase().replace(/\s+/g, "-") || "planificacion"}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const exportPdf = () => {
    const pdf = new jsPDF({
      unit: "mm",
      format: "letter",
      orientation: plan.weeks.length > 4 ? "landscape" : "portrait",
    });
    const margin = 16;
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const contentWidth = pageWidth - margin * 2;
    let y = 18;
    const green = [159, 47, 63];
    const muted = [126, 93, 99];
    const line = [235, 213, 217];
    const safe = (value) => String(value || "").trim();
    const addPageIfNeeded = (height) => {
      if (y + height > pageHeight - 17) {
        pdf.addPage();
        y = 18;
      }
    };
    const heading = (title, subtitle = "") => {
      addPageIfNeeded(18);
      pdf.setTextColor(...green);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(14);
      pdf.text(title, margin, y);
      y += 6;
      if (subtitle) {
        pdf.setTextColor(...muted);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8.5);
        pdf.text(subtitle, margin, y);
        y += 6;
      }
    };
    const field = (label, value, x, width) => {
      pdf.setTextColor(...muted);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7);
      pdf.text(label.toUpperCase(), x, y);
      pdf.setTextColor(35, 45, 40);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      const lines = pdf.splitTextToSize(
        safe(value) || "Sin especificar",
        width,
      );
      pdf.text(lines, x, y + 5);
      return Math.max(11, lines.length * 4 + 7);
    };
    pdf.setFillColor(...green);
    pdf.rect(0, 0, pageWidth, 9, "F");
    pdf.setTextColor(...green);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(22);
    pdf.text(safe(plan.name) || "Nueva planificación", margin, y);
    y += 7;
    pdf.setTextColor(...muted);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.text("Plan de entrenamiento", margin, y);
    y += 12;
    heading("Datos de la planificación");
    pdf.setDrawColor(...line);
    pdf.setFillColor(255, 244, 245);
    pdf.roundedRect(margin, y, contentWidth, 22, 2, 2, "FD");
    const firstRowY = y + 8;
    let maxHeight = 0;
    const planningFields = [
      ["Estudiante", plan.student],
      [
        "Duración",
        `${plan.weeks.length} ${plan.weeks.length === 1 ? "semana" : "semanas"}`,
      ],
      ["Frecuencia", `${plan.weeks[0]?.days.length || 0} días / semana`],
      ["Fecha de inicio", safe(plan.startDate) ? new Date(plan.startDate + "T12:00:00").toLocaleDateString("es-ES") : ""]
    ];
    const planningColumnWidth = contentWidth / planningFields.length;
    planningFields.forEach(([label, value], index) => {
      const oldY = y;
      y = firstRowY;
      maxHeight = Math.max(
        maxHeight,
        field(
          label,
          value,
          margin + 5 + index * planningColumnWidth,
          planningColumnWidth - 10,
        ),
      );
      y = oldY;
    });
    y += 35;
    heading("Perfil del estudiante");
    const profile = plan.studentProfile || {};
    pdf.setDrawColor(...line);
    pdf.setFillColor(255, 244, 245);
    pdf.roundedRect(margin, y, contentWidth, 36, 2, 2, "FD");
    const profileFields = [
      ["Edad", profile.age ? `${profile.age} años` : ""],
      ["Sexo", profile.sex],
      ["Peso", profile.weight ? `${profile.weight} kg` : ""],
      ["Talla", profile.height ? `${profile.height} cm` : ""],
      ["IMC", bmi ? `${bmi} - ${bmiInterpretation}` : ""],
      ["Grasa corporal", profile.bodyFat ? `${profile.bodyFat}%` : ""]
    ];
    profileFields.forEach(([label, value], index) => {
      const col = index % 4;
      const row = Math.floor(index / 4);
      const oldY = y;
      y += 8 + row * 17;
      field(label, value, margin + 5 + col * 45, 38);
      y = oldY;
    });
    y += 49;
    [
      ["Descripción del caso", profile.caseDescription],
      ["Objetivo principal", profile.goal],
      ["Lesiones o limitaciones", profile.injuries],
      ["Antecedentes / notas de salud", profile.medicalNotes],
    ].forEach(([label, value]) => {
      if (!safe(value)) return;
      heading(label);
      pdf.setTextColor(55, 65, 59);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      const lines = pdf.splitTextToSize(value, contentWidth);
      addPageIfNeeded(lines.length * 4 + 4);
      pdf.text(lines, margin, y);
      y += lines.length * 4 + 7;
    });
    if (safe(plan.generalNotes)) {
      heading("Comentario general");
      pdf.setTextColor(55, 65, 59);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      const lines = pdf.splitTextToSize(plan.generalNotes, contentWidth);
      addPageIfNeeded(lines.length * 4 + 4);
      pdf.text(lines, margin, y);
      y += lines.length * 4 + 7;
    }
    // La planificación semanal comienza siempre en una página independiente.
    pdf.addPage();
    y = 18;
    heading(
      "Planificación semanal",
      "Ejercicios organizados por día y semana.",
    );
    comparisonDays.forEach((baseDay, dayIndex) => {
      const rows = comparisonRows[dayIndex];
      const colWidth = contentWidth / (plan.weeks.length + 1);
      const headerFontSize = 8;
      const bodyFontSize = 9;
      const secondaryFontSize = 6.5;
      const lineHeight = 3.7;
      const getCellLines = (
        value,
        fontSize = bodyFontSize,
        fontStyle = "normal",
      ) => {
        pdf.setFont("helvetica", fontStyle);
        pdf.setFontSize(fontSize);
        return pdf.splitTextToSize(String(value || ""), colWidth - 4);
      };
      const drawExerciseCell = (exercise, x, cellY) => {
        const cellLeft = x - 2;
        const drawCenteredLines = (lines, startY, fontSize, fontStyle, color) => {
          pdf.setTextColor(...color);
          pdf.setFont("helvetica", fontStyle);
          pdf.setFontSize(fontSize);
          lines.forEach((line, index) => {
            const lineWidth = pdf.getTextWidth(line);
            pdf.text(line, cellLeft + (colWidth - lineWidth) / 2, startY + index * lineHeight, {
              lineHeightFactor: 1.15,
            });
          });
        };
        if (!exercise) {
          drawCenteredLines(["Libre"], cellY, 8, "normal", [176, 184, 179]);
          return;
        }
        const details = exerciseDetails(exercise);
        const primaryLines = getCellLines(
          details[0] || "Sin parámetros",
          bodyFontSize,
          "bold",
        );
        const secondaryDetails = details.slice(1).map((detail) => {
          const isLoad = detail.startsWith("Carga:");
          const isIntensity =
            exercise.type !== "strength" && detail === exercise.intensity;
          const fontSize = isIntensity ? bodyFontSize : secondaryFontSize;
          const fontStyle = isLoad || isIntensity ? "bold" : "normal";
          return {
            lines: getCellLines(detail, fontSize, fontStyle),
            fontSize,
            fontStyle,
            isLoad,
            isIntensity,
          };
        });
        drawCenteredLines(primaryLines, cellY, bodyFontSize, "bold", green);
        let secondaryY = cellY + primaryLines.length * lineHeight;
        if (secondaryDetails.length) {
          secondaryDetails.forEach((detail) => {
            if (detail.isLoad) {
              const value = detail.lines.join(" ").replace(/^Carga:\s*/, "");
              drawCenteredLines(
                ["Carga:"],
                secondaryY,
                secondaryFontSize,
                "normal",
                [138, 149, 142],
              );
              drawCenteredLines(
                [value],
                secondaryY + lineHeight,
                bodyFontSize,
                "bold",
                [138, 149, 142],
              );
              secondaryY += 2 * lineHeight;
            } else {
              drawCenteredLines(
                detail.lines,
                secondaryY,
                detail.fontSize,
                detail.fontStyle,
                [138, 149, 142],
              );
              secondaryY += detail.lines.length * lineHeight;
            }
          });
        }
        if (exercise.notes) {
          const noteLines = getCellLines(
            exercise.notes,
            secondaryFontSize,
            "italic",
          );
          drawCenteredLines(
            noteLines,
            secondaryY,
            secondaryFontSize,
            "italic",
            [150, 160, 154],
          );
        }
      };
      const headerLines = [
        "EJERCICIO",
        ...plan.weeks.map(
          (weekItem) => `SEMANA ${String(weekItem.number).padStart(2, "0")}`,
        ),
      ].map((value) => getCellLines(value, headerFontSize, "bold"));
      const headerHeight = Math.max(
        10,
        ...headerLines.map((lines) => lines.length * lineHeight + 5),
      );
      const rowHeights = rows.map((row) => {
        const exerciseLabelLines =
          getCellLines(row.name, bodyFontSize, "bold").length +
          (row.description
            ? getCellLines(row.description, secondaryFontSize).length
            : 0);
        const lineCounts = [
          exerciseLabelLines,
          ...plan.weeks.map((weekItem) => {
            const exercise = weekItem.days?.[dayIndex]?.exercises?.find(
              (item) => item.name.trim().toLowerCase() === row.key,
            );
            if (!exercise) return 1;
            const details = exerciseDetails(exercise);
            return (
              getCellLines(
                details[0] || "Sin parámetros",
                bodyFontSize,
                "bold",
              ).length +
              details
                .slice(1)
                .reduce(
                  (total, detail) =>
                    total +
                    (detail.startsWith("Carga:")
                      ? 2
                      : getCellLines(
                        detail,
                        exercise.type !== "strength" &&
                          detail === exercise.intensity
                          ? bodyFontSize
                          : secondaryFontSize,
                        exercise.type !== "strength" &&
                          detail === exercise.intensity
                          ? "bold"
                          : "normal",
                      ).length),
                  0,
                ) +
              (exercise.notes
                ? getCellLines(
                  exercise.notes,
                  secondaryFontSize,
                  "italic",
                ).length
                : 0)
            );
          }),
        ];
        return Math.max(
          11,
          ...lineCounts.map((count) => count * lineHeight + 5),
        );
      });
      const tableHeight =
        6 +
        headerHeight +
        rowHeights.reduce((total, height) => total + height, 0) +
        8;
      const tableCanFitOnPage = tableHeight <= pageHeight - 35;
      // Keep the complete table together whenever it fits on one page.
      addPageIfNeeded(tableCanFitOnPage ? tableHeight : 22);
      pdf.setTextColor(...green);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(11);
      pdf.text(baseDay.name || `Día ${dayIndex + 1}`, margin, y);
      y += 6;
      const drawTableHeader = () => {
        pdf.setFillColor(250, 232, 235);
        pdf.rect(margin, y, contentWidth, headerHeight, "F");
        pdf.setTextColor(125, 61, 72);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(headerFontSize);
        headerLines.forEach((lines, index) => {
          const columnLeft = margin + colWidth * index;
          lines.forEach((line, lineIndex) => {
            pdf.text(
              line,
              columnLeft + (colWidth - pdf.getTextWidth(line)) / 2,
              y + 5 + lineIndex * lineHeight,
              { lineHeightFactor: 1.15 },
            );
          });
        });
        y += headerHeight;
      };
      const drawTableRow = (row, rowHeight) => {
        pdf.setDrawColor(...line);
        pdf.line(margin, y, margin + contentWidth, y);
        pdf.line(margin, y + rowHeight, margin + contentWidth, y + rowHeight);
        for (let column = 1; column <= plan.weeks.length; column++) {
          pdf.line(
            margin + colWidth * column,
            y,
            margin + colWidth * column,
            y + rowHeight,
          );
        }
        pdf.setTextColor(82, 96, 88);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(bodyFontSize);
        const nameLines = getCellLines(row.name, bodyFontSize, "bold");
        nameLines.forEach((line, lineIndex) =>
          pdf.text(
            line,
            margin + 1,
            y + 5 + lineIndex * lineHeight,
            { lineHeightFactor: 1.15 },
          ),
        );
        if (row.description) {
          pdf.setTextColor(138, 149, 142);
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(secondaryFontSize);
          getCellLines(row.description, secondaryFontSize).forEach(
            (descriptionLine, lineIndex) =>
              pdf.text(
                descriptionLine,
                margin + 1,
                y + 5 + (nameLines.length + lineIndex) * lineHeight,
                { lineHeightFactor: 1.15 },
              ),
          );
        }
        plan.weeks.forEach((weekItem, index) => {
          const exercise = weekItem.days?.[dayIndex]?.exercises?.find(
            (item) => item.name.trim().toLowerCase() === row.key,
          );
          drawExerciseCell(
            exercise,
            margin + colWidth * (index + 1) + 2,
            y + 5,
          );
        });
        y += rowHeight;
      };
      drawTableHeader();
      rows.forEach((row, rowIndex) => {
        const rowHeight = rowHeights[rowIndex];
        if (!tableCanFitOnPage && y + rowHeight > pageHeight - 17) {
          pdf.addPage();
          y = 18;
          drawTableHeader();
        }
        drawTableRow(row, rowHeight);
      });
      y += 8;
    });
    const totalPages = pdf.getNumberOfPages();
    for (let page = 1; page <= totalPages; page++) {
      pdf.setPage(page);
      pdf.setTextColor(...muted);
      pdf.setFontSize(7);
      pdf.text(
        `Exeplanner · ${page}/${totalPages}`,
        pageWidth - margin,
        pageHeight - 10,
        { align: "right" },
      );
    }
    pdf.save(
      `${safe(plan.name).toLowerCase().replace(/\s+/g, "-") || "planificacion"}.pdf`,
    );
  };
  const importPlan = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        if (
          imported.version !== 2 ||
          !Array.isArray(imported.sessions) ||
          imported.sessions.length === 0 ||
          imported.sessions.some(
            (session) =>
              !Number.isInteger(session.id) ||
              !Array.isArray(session.exercises) ||
              session.exercises.some((exercise) => !Number.isInteger(exercise.id)),
          )
        )
          throw new Error();
        const normalized = normalizePlan(imported);
        syncNextEntityId(normalized);
        setPlan(normalized);
        setWeekIndex(0);
        setActiveDay(0);
      } catch {
        alert("El archivo no tiene un formato de planificación válido.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Activity size={20} />
          </div>
          <span>
            exe<span>planner</span>
          </span>
        </div>
        <div className="workspace-label">
          PLANIFICADOR LOCAL <ChevronDown size={13} />
        </div>
        <div className="coach">
          <div className="avatar">
            <Dumbbell size={16} />
          </div>
          <div>
            <strong>Exeplanner</strong>
            <small>Sin cuenta ni login</small>
          </div>
        </div>
        <nav>
          <button
            className={tab === "plan" ? "nav-active" : ""}
            onClick={() => setTab("plan")}
          >
            <ClipboardList size={18} /> Mi planificación
          </button>
          <button
            onClick={() => {
              setTab("plan");
              setTimeout(() =>
                document.getElementById("student-profile-input")?.focus(),
              );
            }}
          >
            <UserRound size={18} /> Datos del estudiante
          </button>
          <button
            onClick={() => setTab("library")}
            className={tab === "library" ? "nav-active" : ""}
          >
            <Dumbbell size={18} /> Ejercicios
          </button>
        </nav>
        <div className="sidebar-bottom">
          <button>
            <Settings2 size={18} /> Preferencias
          </button>
          <button>
            <CircleHelp size={18} /> Ayuda y soporte
          </button>
          <div className="pro-card">
            <div className="spark">✦</div>
            <strong>Tu trabajo queda contigo</strong>
            <p>
              Guarda automáticamente en este navegador o exporta un JSON para
              llevarlo donde quieras.
            </p>
            <button onClick={exportPlan}>
              Exportar planificación <ArrowDownToLine size={14} />
            </button>
          </div>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div className="top-actions">
            <button
              className="outline-btn"
              onClick={() => importRef.current?.click()}
            >
              <ArrowUpFromLine size={16} /> Importar{" "}
              <input
                ref={importRef}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={importPlan}
              />
            </button>
            <button className="outline-btn" onClick={exportPlan}>
              <ArrowDownToLine size={16} /> Exportar
            </button>
            <button className="dark-btn" onClick={exportPdf}>
              <FileText size={16} /> Descargar PDF
            </button>
          </div>
        </header>
        <div className="page-wrap">
          <section className="page-heading">
            <div>
              <h1>{plan.name || "Nueva planificación"}</h1>
              <p>
                Diseña, organiza y exporta el plan de entrenamiento de tus
                estudiantes. No necesitas crear una cuenta.
              </p>
            </div>
          </section>
          {tab === "plan" ? (
            <>
              <section className="overview-grid">
                <div className="overview-card profile-card">
                  <div className="student-avatar">
                    {(plan.student || "ES")
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((word) => word[0])
                      .join("")
                      .toUpperCase()}
                  </div>
                  <div className="overview-field">
                    ESTUDIANTE
                    <strong className="overview-student-name">
                      {plan.student || "Nombre del estudiante"}
                    </strong>
                    <span>{plan.studentProfile?.goal || "Sin objetivo definido"}</span>
                  </div>
                </div>
                <div className="overview-card">
                  <div className="card-icon green">
                    <CalendarDays size={18} />
                  </div>
                  <div>
                    <label>DURACIÓN</label>
                    <h3>
                      {plan.weeks.length}{" "}
                      {plan.weeks.length === 1 ? "semana" : "semanas"}
                    </h3>
                  </div>
                </div>
                <div className="overview-card">
                  <div className="card-icon orange">
                    <Flame size={18} />
                  </div>
                  <div>
                    <label>FRECUENCIA</label>
                    <h3>
                      {week.days.length}{" "}
                      {week.days.length === 1 ? "día" : "días"} / semana
                    </h3>
                  </div>
                </div>
              </section>
              <section className="bottom-grid top-details">
                <div className="settings-card">
                  <div className="settings-title">
                    <div className="card-icon pale">
                      <Settings2 size={17} />
                    </div>
                    <div>
                      <h3>Detalles de la planificación</h3>
                      <p>Edita los datos generales sin salir del plan.</p>
                    </div>
                  </div>
                  <div className="form-grid">
                    <label>
                      NOMBRE DEL PLAN
                      <input
                        value={plan.name || ""}
                        onChange={(e) => updatePlan({ name: e.target.value })}
                      />
                    </label>
                    <label>
                      FECHA DE INICIO
                      <input
                        type="date"
                        value={plan.startDate || ""}
                        onChange={(e) =>
                          updatePlan({ startDate: e.target.value })
                        }
                      />
                    </label>
                    <label className="general-notes-field">
                      COMENTARIO GENERAL
                      <textarea
                        value={plan.generalNotes || ""}
                        placeholder="Añade indicaciones, recomendaciones o información importante para todo el plan..."
                        onChange={(e) =>
                          updatePlan({ generalNotes: e.target.value })
                        }
                      />
                    </label>
                  </div>
                </div>
                <div className="settings-card student-details-card">
                  <div className="settings-title">
                    <div className="card-icon pale">
                      <UserRound size={17} />
                    </div>
                    <div>
                      <h3>Perfil del estudiante</h3>
                      <p>
                        Datos útiles para adaptar el entrenamiento y hacer
                        seguimiento.
                      </p>
                    </div>
                    <button
                      className="soft-btn copy-patient-btn"
                      onClick={copyPatientData}
                      type="button"
                    >
                      <Copy size={15} /> {copyStatus || "Copiar perfil"}
                    </button>
                  </div>
                  <div className="form-grid student-form-grid">
                    <label>
                      NOMBRE DEL ESTUDIANTE
                      <input
                        id="student-profile-input"
                        value={plan.student || ""}
                        placeholder="Nombre del estudiante"
                        onChange={(e) => updatePlan({ student: e.target.value })}
                      />
                    </label>
                    <label>
                      EDAD
                      <input
                        type="number"
                        min="0"
                        max="120"
                        value={plan.studentProfile.age}
                        placeholder="Ej. 32"
                        onChange={(e) =>
                          updateStudentProfile({ age: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      SEXO
                      <select
                        value={plan.studentProfile.sex}
                        onChange={(e) =>
                          updateStudentProfile({ sex: e.target.value })
                        }
                      >
                        <option value="">Sin especificar</option>
                        <option value="Femenino">Femenino</option>
                        <option value="Masculino">Masculino</option>
                        <option value="Otro">Otro</option>
                      </select>
                    </label>
                    <label>
                      PESO (KG)
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={plan.studentProfile.weight}
                        placeholder="Ej. 68.5"
                        onChange={(e) =>
                          updateStudentProfile({ weight: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      TALLA (CM)
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={plan.studentProfile.height}
                        placeholder="Ej.  A 170"
                        onChange={(e) =>
                          updateStudentProfile({ height: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      IMC
                      <div className="calculated-field">
                        {bmi || "Se calcula con peso y talla"}
                        {bmi && (
                          <small>
                            {getBmiInterpretation(bmi)}
                          </small>
                        )}
                      </div>
                    </label>
                    <label>
                      % DE GRASA
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={plan.studentProfile.bodyFat}
                        placeholder="Ej. 24"
                        onChange={(e) =>
                          updateStudentProfile({ bodyFat: e.target.value })
                        }
                      />
                    </label>
                    <label className="wide-field profile-final-field">
                      DESCRIPCIÓN DEL CASO
                      <textarea
                        value={plan.studentProfile.caseDescription}
                        placeholder="Describe el caso, sus necesidades y el contexto del paciente..."
                        onChange={(e) =>
                          updateStudentProfile({
                            caseDescription: e.target.value,
                          })
                        }
                      />
                    </label>
                    <label className="wide-field profile-final-field">
                      OBJETIVO PRINCIPAL
                      <textarea
                        value={plan.studentProfile.goal}
                        placeholder="Ej. Mejorar fuerza y movilidad"
                        onChange={(e) =>
                          updateStudentProfile({ goal: e.target.value })
                        }
                      />
                    </label>
                    <label className="wide-field profile-final-field">
                      LESIONES O LIMITACIONES
                      <textarea
                        value={plan.studentProfile.injuries}
                        placeholder="Ej. molestias, operaciones o movimientos que debe evitar..."
                        onChange={(e) =>
                          updateStudentProfile({ injuries: e.target.value })
                        }
                      />
                    </label>
                    <label className="wide-field profile-final-field">
                      ANTECEDENTES / NOTAS DE SALUD
                      <textarea
                        value={plan.studentProfile.medicalNotes}
                        placeholder="Información relevante para planificar con seguridad..."
                        onChange={(e) =>
                          updateStudentProfile({ medicalNotes: e.target.value })
                        }
                      />
                    </label>
                  </div>
                </div>
              </section>
              <section className="editor-card" id="plan-structure">
                <div className="section-header plan-structure-header">
                  <div>
                    <h2>Estructura del plan</h2>
                    <p>Define las sesiones y adapta la prescripción semana a semana.</p>
                  </div>
                  <div className="section-actions">
                    <label className="weeks-count-control">
                      SEMANAS
                      <span className="weeks-stepper">
                        <button
                          type="button"
                          onClick={() => setDuration(plan.weeks.length - 1)}
                          disabled={plan.weeks.length === 1}
                          aria-label="Reducir cantidad de semanas"
                        >
                          −
                        </button>
                        <input
                          type="number"
                          min="1"
                          max="12"
                          value={plan.weeks.length}
                          onChange={(e) => setDuration(e.target.value)}
                          aria-label="Cantidad de semanas"
                        />
                        <button
                          type="button"
                          onClick={() => setDuration(plan.weeks.length + 1)}
                          disabled={plan.weeks.length === 12}
                          aria-label="Aumentar cantidad de semanas"
                        >
                          +
                        </button>
                      </span>
                    </label>
                  </div>
                </div>
                <div className="session-tabs">
                  {week?.days.map((session, index) => (
                    <button
                      key={session.id}
                      onClick={() => {
                        setActiveDay(index);
                        setActiveExercise(0);
                      }}
                      className={index === activeDay ? "session-tab-active" : ""}
                    >
                      Sesión {String(index + 1).padStart(2, "0")}
                      <small>{session.name}</small>
                    </button>
                  ))}
                  <button className="add-session-tab" onClick={addDay}>
                    <Plus size={15} /> Sesión
                  </button>
                </div>
                <div className="session-layout">
                  <div className="exercise-list-panel">
                    <div className="day-list-title">
                      <span>
                        EJERCICIOS DE LA SESIÓN
                      </span>
                      <div className="day-actions">
                        <button
                          className="danger-link"
                          onClick={removeExerciseFromSession}
                          disabled={(day?.exercises.length || 0) <= 1}
                        >
                          <Trash2 size={14} /> Eliminar ejercicio
                        </button>
                      </div>
                    </div>
                    {day?.exercises.map((ex, i) => (
                      <button
                        key={ex.id}
                        className={`day-item ${i === activeExercise ? "day-active" : ""}`}
                        onClick={() => setActiveExercise(i)}
                      >
                        <span className="day-number">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span className="day-info">
                          <strong>{ex.name || "Sin nombre"}</strong>
                          <small>{ex.type === "strength" ? "Fuerza" : ex.type === "cardio" ? "Cardio" : "Movilidad"}</small>
                        </span>
                        <ChevronRight size={17} />
                      </button>
                    ))}
                    <button className="add-exercise-list" onClick={addExerciseToSession}>
                      <Plus size={15} /> Añadir ejercicio
                    </button>
                  </div>
                  <div className="plan-exercise-editor">
                    {day && selectedExercise && (
                      <>
                        <div className="day-editor-title">
                          <div>
                            <span className="session-kicker">
                              SESIÓN {String(activeDay + 1).padStart(2, "0")} <span>•</span> ESTRUCTURA DEL PLAN
                            </span>
                            <input
                              className="title-input"
                              value={day.name}
                              onChange={(e) => updateSessionStructure({ name: e.target.value })}
                            />
                            <p>El ejercicio se mantiene en todas las semanas. Edita aquí su prescripción progresiva.</p>
                          </div>
                        </div>
                        <div className="selected-exercise-header">
                          <div>
                            <span className="field-kicker">EJERCICIO SELECCIONADO</span>
                            <input
                              className="selected-exercise-name"
                              value={selectedExercise.name}
                              onChange={(e) => updateExerciseStructure({ name: e.target.value })}
                            />
                          </div>
                          <label className="selected-exercise-description">
                            DESCRIPCIÓN DEL EJERCICIO
                            <textarea
                              value={selectedExercise.description || ""}
                              placeholder="Describe cómo se realiza o qué objetivo tiene..."
                              onChange={(e) =>
                                updateExerciseStructure({
                                  description: e.target.value,
                                })
                              }
                            />
                          </label>
                          <label>
                            TIPO
                            <select
                              value={selectedExercise.type || "strength"}
                              onChange={(e) => updateExerciseStructure({ type: e.target.value })}
                            >
                              <option value="strength">Fuerza</option>
                              <option value="cardio">Cardio</option>
                              <option value="mobility">Movilidad</option>
                            </select>
                          </label>
                        </div>
                        <div className="prescription-table">
                          <div className="prescription-table-header">
                            <span>SEMANA</span>
                            <span>{selectedExercise.type === "cardio" || selectedExercise.type === "mobility" ? "MÉTRICA" : "SERIES"}</span>
                            <span>{selectedExercise.type === "cardio" || selectedExercise.type === "mobility" ? "INTENSIDAD" : "REPETICIONES"}</span>
                            <span>{selectedExercise.type === "strength" ? "CARGA" : "NOTAS"}</span>
                            <span>{selectedExercise.type === "strength" ? "DESCANSO (S)" : ""}</span>
                            <span>{selectedExercise.type === "strength" ? "NOTAS" : ""}</span>
                          </div>
                          {plan.weeks.map((targetWeek) => {
                            const ex = getWeekExercise(targetWeek);
                            const isStrength = selectedExercise.type === "strength";
                            return (
                              <div
                                className={`prescription-row ${highlightedWeek === targetWeek.number ? "prescription-row-highlight" : ""}`}
                                key={targetWeek.id}
                              >
                                <button
                                  className="prescription-week-link"
                                  type="button"
                                  onClick={() =>
                                    goToSummaryCell(
                                      activeDay,
                                      plan.weeks.indexOf(targetWeek),
                                      selectedExercise.id,
                                    )
                                  }
                                >
                                  Semana {String(targetWeek.number).padStart(2, "0")}
                                </button>
                                <input
                                  value={isStrength ? ex.sets : ex.metric || ""}
                                  placeholder={isStrength ? "3" : "30 min"}
                                  onChange={(e) => updateExercisePrescription(targetWeek.number, isStrength ? { sets: e.target.value } : { metric: e.target.value })}
                                />
                                <input
                                  value={isStrength ? ex.reps : ex.intensity || ""}
                                  placeholder={isStrength ? "10" : "Moderada"}
                                  onChange={(e) => updateExercisePrescription(targetWeek.number, isStrength ? { reps: e.target.value } : { intensity: e.target.value })}
                                />
                                <input
                                  value={isStrength ? ex.load : ex.notes || ""}
                                  placeholder={isStrength ? "20 kg" : "Notas"}
                                  onChange={(e) => updateExercisePrescription(targetWeek.number, isStrength ? { load: e.target.value } : { notes: e.target.value })}
                                />
                                {isStrength && (
                                  <input
                                    value={ex.rest || ""}
                                    placeholder="60"
                                    onChange={(e) => updateExercisePrescription(targetWeek.number, { rest: e.target.value })}
                                  />
                                )}
                                {isStrength && (
                                  <input
                                    value={ex.notes || ""}
                                    placeholder="Notas"
                                    onChange={(e) => updateExercisePrescription(targetWeek.number, { notes: e.target.value })}
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                  <div className="day-editor legacy-editor-hidden">
                    {day && (
                      <>
                        <div className="day-editor-title">
                          <div>
                            <span className="session-kicker">
                              DÍA {String(activeDay + 1).padStart(2, "0")}{" "}
                              <span>•</span> SEMANA{" "}
                              {String(week.number).padStart(2, "0")}
                            </span>
                            <input
                              className="title-input"
                              value={day.name}
                              onChange={(e) =>
                                updateDay({ name: e.target.value })
                              }
                            />
                            <p>
                              Define los ejercicios y parámetros para esta
                              sesión.
                            </p>
                          </div>
                        </div>
                        <div className="exercise-head">
                          <h3>
                            Ejercicios <span>{day.exercises.length}</span>
                          </h3>
                          <button
                            className="outline-btn small"
                            onClick={() =>
                              updateDay({
                                exercises: [...day.exercises, makeExercise()],
                              })
                            }
                          >
                            <Plus size={15} /> Añadir ejercicio
                          </button>
                        </div>
                        <div className="exercise-table">
                          <div className="table-labels">
                            <span></span>
                            <span>EJERCICIO</span>
                            <span>TIPO</span>
                            <span>PARÁMETROS</span>
                            <span></span>
                          </div>
                          {day.exercises.map((ex) => (
                            <div
                              className="exercise-row"
                              id={`exercise-${ex.id}`}
                              key={ex.id}
                            >
                              <GripVertical size={16} className="drag" />
                              <input
                                className="exercise-name"
                                value={ex.name}
                                onChange={(e) =>
                                  updateExercise(ex.id, {
                                    name: e.target.value,
                                  })
                                }
                              />
                              <select
                                className="exercise-type"
                                value={ex.type || "strength"}
                                onChange={(e) =>
                                  updateExercise(ex.id, {
                                    type: e.target.value,
                                  })
                                }
                              >
                                <option value="strength">Fuerza</option>
                                <option value="cardio">Cardio</option>
                                <option value="mobility">Movilidad</option>
                              </select>
                              <div className="exercise-parameters">
                                {ex.type === "cardio" ? (
                                  <>
                                    <label>
                                      TIEMPO / DISTANCIA
                                      <input
                                        value={ex.metric || ""}
                                        placeholder="Ej. 30 min o 5 km"
                                        onChange={(e) =>
                                          updateExercise(ex.id, {
                                            metric: e.target.value,
                                          })
                                        }
                                      />
                                    </label>
                                    <label>
                                      INTENSIDAD
                                      <input
                                        value={ex.intensity || ""}
                                        placeholder="Ej. RPE 7"
                                        onChange={(e) =>
                                          updateExercise(ex.id, {
                                            intensity: e.target.value,
                                          })
                                        }
                                      />
                                    </label>
                                  </>
                                ) : ex.type === "mobility" ? (
                                  <>
                                    <label>
                                      TIEMPO
                                      <input
                                        value={ex.metric || ""}
                                        placeholder="Ej. 10 min"
                                        onChange={(e) =>
                                          updateExercise(ex.id, {
                                            metric: e.target.value,
                                          })
                                        }
                                      />
                                    </label>
                                    <label>
                                      INTENSIDAD
                                      <input
                                        value={ex.intensity || ""}
                                        placeholder="Ej. Suave"
                                        onChange={(e) =>
                                          updateExercise(ex.id, {
                                            intensity: e.target.value,
                                          })
                                        }
                                      />
                                    </label>
                                  </>
                                ) : (
                                  <>
                                    <label>
                                      SERIES
                                      <input
                                        value={ex.sets}
                                        placeholder="Ej. 3"
                                        onChange={(e) =>
                                          updateExercise(ex.id, {
                                            sets: e.target.value,
                                          })
                                        }
                                      />
                                    </label>
                                    <label>
                                      REPETICIONES
                                      <input
                                        value={ex.reps}
                                        placeholder="Ej. 10"
                                        onChange={(e) =>
                                          updateExercise(ex.id, {
                                            reps: e.target.value,
                                          })
                                        }
                                      />
                                    </label>
                                    <label>
                                      CARGA
                                      <input
                                        value={ex.load}
                                        placeholder="Ej. 20 kg"
                                        onChange={(e) =>
                                          updateExercise(ex.id, {
                                            load: e.target.value,
                                          })
                                        }
                                      />
                                    </label>
                                    <label>
                                      DESCANSO (S)
                                      <input
                                        value={ex.rest}
                                        placeholder="60"
                                        onChange={(e) =>
                                          updateExercise(ex.id, {
                                            rest: e.target.value,
                                          })
                                        }
                                      />
                                    </label>
                                  </>
                                )}
                              </div>
                              <button
                                className="delete-btn"
                                onClick={() => removeExercise(ex.id)}
                                title="Eliminar ejercicio"
                              >
                                <Trash2 size={16} />
                              </button>
                              <div className="exercise-note">
                                <FileText size={14} />
                                <input
                                  value={ex.notes}
                                  placeholder="Añadir nota para este ejercicio..."
                                  onChange={(e) =>
                                    updateExercise(ex.id, {
                                      notes: e.target.value,
                                    })
                                  }
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                        <button
                          className="add-exercise"
                          onClick={() =>
                            updateDay({
                              exercises: [...day.exercises, makeExercise()],
                            })
                          }
                        >
                          <Plus size={16} /> Añadir otro ejercicio
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </section>
              <section className="comparison-section" id="plan-summary">
                <div className="comparison-heading">
                  <div>
                    <h2>Resumen por semanas</h2>
                    <p>
                      Compara la progresión de cada ejercicio a lo largo del
                      plan.
                    </p>
                  </div>
                </div>
                {comparisonDays.map((baseDay, dayIndex) => (
                  <div
                    className="comparison-card"
                    key={`comparison-${baseDay.id}`}
                  >
                    <div className="comparison-title">
                      <span className="comparison-day-number">
                        {String(dayIndex + 1).padStart(2, "0")}
                      </span>
                      <h3>{baseDay.name || `Día ${dayIndex + 1}`}</h3>
                    </div>
                    <div className="comparison-table-wrap">
                      <table className="comparison-table">
                        <thead>
                          <tr>
                            <th>Ejercicio</th>
                            {plan.weeks.map((w) => (
                              <th key={w.id}>
                                Semana {String(w.number).padStart(2, "0")}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {comparisonRows[dayIndex].map((row) => (
                            <tr key={`comparison-${dayIndex}-${row.key}`}>
                              <th>
                                <span>{row.name || "Sin nombre"}</span>
                                {row.description && (
                                  <small className="comparison-exercise-description">
                                    {row.description}
                                  </small>
                                )}
                              </th>
                              {plan.weeks.map((w, targetWeekIndex) => {
                                const currentDay = w.days?.[dayIndex];
                                const exercise = currentDay?.exercises?.find(
                                  (item) =>
                                    item.name.trim().toLowerCase() === row.key,
                                );
                                return (
                                  <td
                                    key={w.id}
                                    id={
                                      exercise
                                        ? `summary-cell-${dayIndex}-${targetWeekIndex}-${exercise.id}`
                                        : undefined
                                    }
                                  >
                                    {exercise ? (
                                      <button
                                        className={`comparison-exercise-link ${highlightedSummaryCell === `summary-cell-${dayIndex}-${targetWeekIndex}-${exercise.id}` ? "summary-cell-highlight" : ""}`}
                                        onClick={() =>
                                          editExerciseFromSummary(
                                            targetWeekIndex,
                                            dayIndex,
                                            exercise.id,
                                          )
                                        }
                                        title={`Editar ${exercise.name} en la semana ${w.number}`}
                                      >
                                        {exerciseDetails(exercise).map(
                                          (detail, index) =>
                                            index === 0 ? (
                                              <strong key={`${detail}-${index}`}>
                                                {detail}
                                              </strong>
                                            ) : detail.startsWith("Carga:") ? (
                                              <span className="comparison-load" key={`${detail}-${index}`}>
                                                <small>Carga:</small>
                                                <strong className="load-value">
                                                  {detail.slice(6).trim()}
                                                </strong>
                                              </span>
                                            ) : (
                                              <small key={`${detail}-${index}`}>
                                                {detail}
                                              </small>
                                            ),
                                        )}
                                        {exercise.notes && (
                                          <small className="comparison-exercise-note">
                                            <FileText size={9} /> {exercise.notes}
                                          </small>
                                        )}
                                      </button>
                                    ) : (
                                      <span className="empty-cell">-</span>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </section>
            </>
          ) : (
            <div className="empty-state">
              <Search size={30} />
              <h2>
                {tab === "students"
                  ? "Estudiantes"
                  : "Biblioteca de ejercicios"}
              </h2>
              <p>Esta sección estará disponible en la próxima versión.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
