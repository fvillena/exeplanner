# Plan: Compartir planificación con estudiante

## Objetivo

Permitir que el prescriptor publique una planificación desde la aplicación actual, genere un enlace privado para el estudiante y mantenga sincronizada la prescripción original con los datos reales registrados por el estudiante. El estudiante podrá editar únicamente la ejecución realizada, restaurar por ejercicio los valores prescritos y el prescriptor podrá consultar la prescripción junto con el estado actual realizado.

## Decisiones confirmadas

- Persistencia compartida en MongoDB Atlas.
- Backend separado en Node.js con Express; no se accederá a MongoDB directamente desde el navegador.
- El estudiante no necesita cuenta: accede mediante un token privado de enlace.
- El prescriptor accede mediante un token privado independiente.
- El enlace del estudiante es sincronizado: futuras publicaciones/actualizaciones del plan conservan el enlace y actualizan la receta.
- El estudiante solo modifica ejecución: series, repeticiones, carga/métrica, descanso, notas y estado completado.
- Nombre, estructura, ejercicios y prescripción quedan bloqueados para el estudiante.
- Restaurar reemplaza la edición actual del ejercicio por la prescripción; se permite por ejercicio.
- No se requiere historial detallado; se conserva únicamente el estado actual realizado.

## Estado actual relevante

- `src/main.jsx` contiene toda la aplicación React y actualmente usa un modelo normalizado interno `weeks[].days[].exercises[]`.
- La importación/exportación externa usa el esquema `sessions[].exercises[].plan[]` mediante `normalizePlan` y `toSchemaPlan`.
- La persistencia local está desactivada y el montaje elimina `localStorage`; debe reemplazarse por carga/guardado explícito según el modo de ruta.
- No existe backend ni autenticación. `package.json` solo contiene Vite/React y dependencias de UI/PDF.

## Modelo MongoDB

Crear una colección `plans` con documentos que contengan:

- `publicId` o `_id` interno.
- `studentTokenHash` y `prescriberTokenHash`, almacenados como hashes; nunca guardar tokens en claro.
- `studentTokenCreatedAt`, `prescriberTokenCreatedAt`, `revokedAt` opcional y `lastPublishedAt`.
- `prescribedPlan`: snapshot completo del esquema `version: 2`, incluyendo perfil, sesiones, semanas y metadatos del prescriptor.
- `execution`: mapa/array indexado de forma estable por semana, sesión y ejercicio, con `sets`, `reps`, `load`, `rest`, `metric`, `intensity`, `notes`, `completed` y `updatedAt`.
- `updatedAt` y `createdAt`.

Usar el ID estable del ejercicio y el número de semana para relacionar ejecución con prescripción. Al publicar cambios estructurales, conservar ejecuciones de claves que sigan existiendo y eliminar o marcar como obsoletas las que ya no estén presentes. Añadir índices únicos para tokens hash y un índice temporal si se incorpora expiración.

## API Express

Crear una aplicación backend separada, por ejemplo `server/`, con configuración por variables de entorno (`MONGODB_URI`, `MONGODB_DB`, `PORT`, `CORS_ORIGIN`, secreto para generación/hash si aplica).

Endpoints mínimos:

- `POST /api/plans`: recibe el plan normalizado del prescriptor, valida el esquema y devuelve enlaces/token una sola vez, además de identificadores públicos.
- `PUT /api/plans/:id/prescription`: autenticado con token de prescriptor; valida y reemplaza la receta, preservando ejecuciones compatibles.
- `GET /api/student/plans/:studentToken`: devuelve la receta pública y la ejecución actual, nunca el token del prescriptor.
- `PATCH /api/student/plans/:studentToken/execution`: valida que solo se modifiquen campos de ejecución y realiza actualización atómica por ejercicio/semana.
- `POST /api/student/plans/:studentToken/execution/reset`: restaura un ejercicio concreto desde la prescripción, validando semana/sesión/ejercicio y reemplazando solo su ejecución.
- `GET /api/prescriber/plans/:prescriberToken`: devuelve la receta y ejecución actual para comparación, sin exponer hashes ni tokens.

Aplicar CORS restringido, rate limiting para endpoints públicos, límites de tamaño JSON, validación estricta de tokens y respuestas que no revelen si otros tokens existen. Generar tokens criptográficamente aleatorios y compararlos mediante hash seguro.

## Frontend

Introducir detección de modo por ruta:

- Modo actual de edición del prescriptor: mantiene el editor completo y añade `Compartir con estudiante`.
- Ruta de estudiante, por ejemplo `/student/:token`: carga la receta desde la API, renderiza una vista móvil orientada a completar sesiones y habilita solo campos de ejecución. Cada ejercicio muestra prescrita y realizada, con botón `Volver a prescrita`.
- Ruta de prescriptor, por ejemplo `/prescriber/:token`: vista de solo lectura con selector de semana/sesión y comparación prescrita vs realizada, incluyendo marcas de completado y última actualización.

Separar la lógica de API de `main.jsx` en un módulo pequeño (`src/api.js` o equivalente). Añadir estados de carga, error, guardado y conflicto. Usar debounce o guardado explícito para evitar una petición por cada pulsación; preferir guardado explícito por ejercicio con confirmación visual. No guardar tokens en `localStorage` salvo que sea necesario para navegación; el token de URL debe permanecer en la URL y no aparecer en logs.

En el editor del prescriptor, el botón de compartir debe publicar `toSchemaPlan(plan)`, mostrar el enlace del estudiante y el enlace del prescriptor, y permitir copiar cada uno. La publicación posterior debe llamar a `PUT` usando el token de prescriptor asociado a esa sesión de edición.

## Compatibilidad y migración

- Mantener el formato JSON existente para importación/exportación.
- Normalizar el documento recibido antes de enviarlo al backend para evitar persistir el modelo interno dependiente de índices.
- No migrar automáticamente datos de `localStorage`, porque la persistencia local está explícitamente desactivada; si se decide recuperar importaciones antiguas, ofrecer carga manual del JSON.
- El backend debe aceptar los campos opcionales actuales y producir valores vacíos por defecto donde el frontend los necesite.

## Validación

- Tests de validación del esquema: plan válido, IDs faltantes, semanas no consecutivas, tipos inválidos y payload de ejecución con campos prohibidos.
- Tests de autorización: token de estudiante no puede consultar prescriptor ni modificar prescripción; token de prescriptor no puede acceder a otros planes.
- Tests de persistencia: publicación, lectura por ambos enlaces, actualización de ejecución, restauración individual y republicación conservando ejecuciones compatibles.
- Tests de frontend: modo estudiante bloquea estructura/prescripción, guarda edición, restaura un ejercicio y muestra errores de red; modo prescriptor muestra diferencias.
- Ejecutar `npm run build` del frontend y el script de tests del backend.
- Verificar manualmente dos navegadores/dispositivos: cambiar ejecución en estudiante y comprobarla en la vista del prescriptor; actualizar la prescripción y comprobar sincronización sin perder registros compatibles.

## Riesgos y límites

- Un enlace con token funciona como credencial; debe poder revocarse y regenerarse desde el prescriptor.
- Sin cuenta, no existe recuperación de acceso del estudiante más allá de regenerar el enlace.
- El modelo de estado actual no ofrece auditoría; una futura necesidad de historial requerirá una colección de eventos o versiones, no debe improvisarse dentro del documento actual.
- Si se permite editar la prescripción local antes de publicar, la API debe tratar cada publicación como reemplazo validado y no como modificaciones parciales desde el cliente.
