# Biblioteca de ejercicios

## Objetivo y decisiones acordadas

Implementar el unico pendiente de `TODO.md`: integrar https://github.com/hasaneyldrm/exercises-dataset en el editor del prescriptor.

- Solo textos. Excluir imagenes, GIF y referencias a medios: su licencia es distinta de MIT.
- Conservar nombres originales en ingles, editables; instrucciones preferentemente en espanol. Interfaz y filtros en espanol.
- Anadir ejercicios desde una biblioteca, conservando el boton de creacion manual. No sustituir ejercicios existentes en esta entrega.
- Incluir una copia reducida y versionada del catalogo en la aplicacion. No consultar GitHub durante el uso ni durante la compilacion.
- Copiar nombre, descripcion y tipo al plan; no introducir metadatos nuevos ni cambiar version 2, API, MongoDB o persistencia.

## Contexto y precauciones

- `src/main.jsx`: `makeExercise` (63), conversiones (115-198), `addExerciseToSession` (921-935), boton de alta (2130). Comprobar lineas actuales antes de editar.
- Los ejercicios comparten ID y definicion entre semanas, pero tienen prescripciones individuales. Nunca usar el ID externo del catalogo como ID del plan.
- Autosave de 800 ms; abrir, buscar y cerrar la biblioteca no deben modificar `plan` ni publicar nada. Confirmar un alta usa el flujo normal, nunca el guardado manual.
- Hay cambios previos en `TODO.md` y un `AGENTS.md` no versionado. Preservarlos; al terminar actualizar solo la casilla pertinente del TODO.
- El JSON remoto completo pesa 17.391.530 bytes; no incorporarlo entero al bundle principal.

## Implementacion

1. **Preparar los datos y su licencia.** Obtener el JSON desde una revision concreta del repositorio y registrar esa revision y la fuente junto al adaptador. Generar `src/data/exercises.json` reducido con ID externo (string), nombre, categoria/zona, equipamiento, musculo objetivo y descripcion. Usar instrucciones ES no vacias, EN como respaldo; descartar otros idiomas, duplicacion de pasos y todos los campos de medios. Validar IDs unicos y campos necesarios y comprobar el numero real de registros, sin asumir que siempre seran 1.324. Incluir el texto completo de LICENSE del origen en `src/data/exercises.LICENSE.txt`, conservando copyright y excepcion de medios. No hace falta mantener el JSON completo ni construir un sistema de actualizacion.

2. **Carga y busqueda.** Crear un modulo pequeno, por ejemplo `src/exercise-library.js`, para cargar el JSON estatico con `fetch(new URL("./data/exercises.json", import.meta.url))` solo al abrir el selector. Vite debe emitirlo como recurso separado y resolver su URL tambien bajo `/p/:token`. Reutilizar datos cargados y peticiones concurrentes; permitir reintentar tras un fallo, sin cachear permanentemente un rechazo. Validar respuesta HTTP y estructura, tratar el contenido como texto, sin HTML. Filtrar localmente por consulta y por zona corporal y equipamiento, combinando todos los filtros. Buscar sin distinguir mayusculas o tildes en nombre, descripcion y metadatos, incluyendo etiquetas traducidas. Traducir las opciones de zona y equipamiento presentes en la copia fijada; conservar el original como respaldo para valores desconocidos. Reiniciar paginacion al cambiar filtros.

3. **Selector accesible.** En `src/main.jsx`, anadir `Anadir desde biblioteca` junto a `Anadir ejercicio`, solo en el editor del prescriptor. Abrir un dialogo modal accesible con titulo, buscador, filtros, contador y resultados paginados (por ejemplo 30 por pagina). Cada resultado muestra nombre, zona, equipamiento, descripcion consultable y boton explicito `Anadir a la sesion`; no anadir al pulsar una tarjeta o un filtro. Mostrar carga, error con reintento, vacio y limpieza de filtros. Incluir enlace al repositorio y al archivo de licencia mediante una URL de recurso Vite. Gestionar foco inicial en busqueda, Tab dentro del modal, Escape/cancelacion y restauracion del foco al cerrar. Usar dialogo nativo si encaja con los navegadores del proyecto. El modal bloquea interaccion con la sesion subyacente; no permitir confirmar contra una sesion eliminada.

4. **Alta segura.** Extender `addExerciseToSession` para aceptar opcionalmente una definicion, conservando el comportamiento manual. Evitar recibir accidentalmente el evento React como definicion: el boton manual debe llamar mediante funcion sin argumentos. Crear una sola vez el ejercicio con `makeExercise`, copiar solo nombre/descripcion/tipo permitidos y mantener sus valores iniciales de prescripcion. Tipo `cardio` para categoria cardio; `strength` por defecto para el resto, sin inferencias ambiguas; el prescriptor puede cambiarlo a movilidad. Anadir al final de la sesion destino en todas las semanas con el mismo ID local y copias independientes; preservar todos los ejercicios y prescripciones previos. Seleccionar el nuevo ejercicio y cerrar el selector. No actualizar ejercicios ya creados cuando cambie el catalogo. No cambiar conversiones ni mostrar dependencia de biblioteca en estudiante o PDF.

5. **Presentacion.** Ampliar `src/styles.css` reutilizando variables, tipografia y lenguaje visual existentes. Dialogo con altura limitada y desplazamiento interno; filtros y acciones apilables en movil, sin desbordamiento horizontal. Mantener la biblioteca fuera del PDF y de la vista de estudiante.

6. **Pruebas y cierre.** Ampliar `src/autosave.test.js` y su arnes para el modulo nuevo, carga simulada y dialogo, sin descargas de red en tests. Si se separan tests del modulo, incluirlos en `npm test`. Tras validar, marcar el pendiente en `TODO.md` sin alterar sus otros cambios. Actualizar `AGENTS.md` solo con las nuevas ubicaciones e invariantes utiles, preservando su contenido y sin historiales de resultados.

## Validacion

- Datos: licencia incluida, IDs unicos, instrucciones ES y respaldo EN, ausencia de medios y de otros idiomas; recurso separado del JS principal y sin solicitudes al abrir la aplicacion o la vista estudiante.
- Busqueda: mayusculas/tildes, nombre ingles, texto espanol, filtros combinados, valores desconocidos, paginacion y cero resultados.
- Carga: exito, fallo HTTP/JSON, reintento, cierre durante carga y reapertura sin peticiones duplicadas tras exito.
- Integracion: abrir/buscar/cancelar no modifica plan ni guarda; confirmar anade exactamente un ejercicio; dos altas del mismo catalogo crean IDs locales distintos; todas las semanas y solo la sesion destino reciben el mismo nuevo ID; prescripciones anteriores intactas. Confirmar que el boton manual sigue funcionando y que editar nombre/descripcion propaga la definicion entre semanas.
- Autosave: debounce de 800 ms, cambios durante peticion, ejecuciones conservadas y ausencia de llamada a la resolucion manual de sugerencias. Ida y vuelta JSON de nombre, descripcion y tipo, y compatibilidad de planes anteriores.
- Ejecutar `npm.cmd test`, `npm.cmd run build` y `git diff --check`. Verificar que el build contiene JSON y licencia referenciados con URLs validas. El Dockerfile copia `src`, por lo que esta ubicacion no necesita ampliar sus COPY.
- Si Docker esta disponible, revisar servicios activos y ejecutar solo `docker compose up -d --no-deps --build frontend`. Comprobar `/`, recurso del catalogo, licencia y `/api/health` (`ok: true`, `database: true`) a traves de localhost:8080. Nunca recrear MongoDB ni ejecutar compose down. Si Docker no esta disponible, documentar esa limitacion.
- Verificacion en navegador si hay herramienta disponible: escritorio y movil, teclado/foco/Escape, alta desde `/` y `/p/:token`, persistencia tras recarga y descripcion expandible en estudiante. Comprobar PDF con instrucciones largas sin recortes; si el texto del catalogo reproduce un desbordamiento, corregirlo de forma acotada antes de dar por valida la integracion. No afirmar verificacion visual o PDF si no se ejecuto.

## Limites y despliegue

No hay migracion de datos ni despliegue backend. Los planes siguen siendo instantaneas editables independientes del catalogo. Sin traduccion automatica de nombres, medios, sustitucion de ejercicios, biblioteca personal ni sincronizacion remota. No crear commits sin solicitud. La implementacion requiere salir del modo planificacion y continuar con un agente habilitado para editar codigo.
