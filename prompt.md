# Prompt para generar una planificación Exeplanner

Actúa como profesional de la planificación del entrenamiento. Genera una planificación personalizada usando exclusivamente el perfil del paciente que aparece al final.

## Reglas de respuesta

1. Devuelve únicamente el JSON de la planificación dentro de un bloque de código Markdown etiquetado como `json`, usando exactamente este formato: ```json ... ```.
2. El JSON debe poder importarse directamente en Exeplanner.
3. Conserva exactamente los datos del paciente. Si falta un dato, usa `""`.
4. Genera una planificación segura, progresiva y coherente con el objetivo, el caso, las lesiones y los antecedentes.
5. Usa únicamente IDs enteros positivos. Los IDs de sesiones, ejercicios y semanas deben ser únicos dentro de sus respectivas colecciones.
6. No uses un atributo raíz `weeks` ni una estructura `weeks[].sessions`.
7. No inventes información clínica, diagnósticos, lesiones, medidas ni antecedentes.
8. No incluyas ejercicios que contradigan las lesiones o limitaciones indicadas.
9. Usa nombres de ejercicios claros en español y parámetros realistas para el nivel del paciente.

Los parámetros antropométricos son obligatorios y deben copiarse dentro de `studentProfile`:

- `age`: edad únicamente como número en texto, por ejemplo `"32"`, no `"32 años"`.
- `weight`: peso únicamente como número en texto, por ejemplo `"72"`, no `"72 kg"`.
- `height`: talla únicamente como número en texto, por ejemplo `"165"`, no `"165 cm"`.
- `bodyFat`: porcentaje únicamente como número en texto, por ejemplo `"30"`, no `"30%"`.

No añadas unidades, símbolos ni descripciones a estos cuatro campos. Las unidades solo deben aparecer en las prescripciones de los ejercicios, como `load`, `metric` o `reps`.

Antes de responder, verifica obligatoriamente que:

- `version` sea el número `2`, nunca una cadena y nunca `1.0`.
- Exista `sessions` como array.
- No exista `weeks` en el objeto raíz.
- Cada sesión tenga un `id` entero y un array `exercises`.
- Cada ejercicio tenga `id` entero, `name`, `type`, `order` y `plan`.
- `studentProfile` tenga siempre `age`, `sex`, `weight`, `height`, `bodyFat`, `injuries`, `medicalNotes`, `caseDescription` y `goal`.
- `age`, `weight`, `height` y `bodyFat` conserven exactamente el formato numérico en texto, sin unidades.
- Todos los ejercicios tengan una entrada `plan` por cada semana.
- Todos los valores de `week` sean enteros consecutivos desde `1`.
- Todos los IDs de sesión y ejercicio sean enteros positivos.
- No haya texto antes ni después del bloque `json`.

## Esquema

El objeto raíz debe tener exactamente estos campos: `version`, `name`, `student`, `studentProfile`, `startDate`, `generalNotes` y `sessions`.

La estructura de `studentProfile` es:

```json
{
  "age": "",
  "sex": "",
  "weight": "",
  "height": "",
  "bodyFat": "",
  "injuries": "",
  "medicalNotes": "",
  "caseDescription": "",
  "goal": ""
}
```

Los datos numéricos del perfil deben conservarse como cadenas. `startDate` debe usar el formato `YYYY-MM-DD`. Si no se proporciona una fecha, utiliza la fecha actual.

Cada sesión se define una sola vez:

```json
{
  "id": 1,
  "name": "Fuerza global",
  "exercises": [
    {
      "id": 1,
      "name": "Sentadilla goblet",
      "description": "Sentarse y levantarse de una silla manteniendo el control del movimiento.",
      "type": "strength",
      "order": 1,
      "plan": [
        {
          "week": 1,
          "sets": "3",
          "reps": "12",
          "load": "8 kg",
          "rest": "60"
        },
        {
          "week": 2,
          "sets": "3",
          "reps": "12",
          "load": "10 kg",
          "rest": "60",
          "notes": "Aumentar solo si la técnica se mantiene."
        }
      ]
    }
  ]
}
```

`plan` pertenece a cada ejercicio y contiene su progresión semanal. Incluye exactamente una entrada por cada semana. `week` es un entero consecutivo desde `1`. Los campos `sets`, `reps`, `load`, `rest`, `metric`, `intensity` y `notes` son opcionales según el tipo de ejercicio; no añadas campos vacíos innecesarios. `notes`, cuando exista, es específica de esa semana y no debe copiarse automáticamente a las demás semanas.

Los mismos ejercicios deben conservar el mismo `id` durante todo el plan. No dupliques ejercicios por semana: la progresión debe estar dentro de `exercise.plan`. `description` es opcional y pertenece al ejercicio, no a una semana. Úsala para explicar cómo se realiza, qué objetivo tiene o qué adaptación requiere. `order` debe ser consecutivo dentro de cada sesión. `type` solo puede ser `strength`, `cardio` o `mobility`.

Para ejercicios de fuerza utiliza principalmente `sets`, `reps`, `load` y `rest`. Para cardio y movilidad utiliza `metric` e `intensity`. La intensidad debe ser una indicación como `Suave`, `Moderada`, `Alta`, `RPE 7` o `Zona 2`. `metric` debe indicar duración, distancia o volumen, por ejemplo `30 minutos`, `5 km` o `10 repeticiones por lado`.

## Criterios de planificación

- Genera entre 1 y 12 semanas.
- Mantén la misma cantidad de sesiones y los mismos ejercicios durante todo el plan.
- Cambia las prescripciones dentro de `plan` para representar la progresión.
- La semana 1 debe establecer la base del plan. Las semanas siguientes deben progresar de forma gradual desde esa base.
- Si el paciente es principiante o la información es limitada, prioriza progresiones conservadoras y deja las precauciones en `generalNotes`.
- Prioriza adherencia, técnica y recuperación.
- Ajusta volumen, complejidad, carga e intensidad al nivel descrito.
- Incluye calentamiento, progresión, criterios para reducir la carga y precauciones en `generalNotes`.
- No diagnostiques ni sustituyas la valoración de un profesional sanitario.

## Perfil del paciente

Usa exclusivamente la siguiente información como contexto:

<!-- Pega aquí el contenido generado por el botón "Copiar perfil en Markdown". -->
