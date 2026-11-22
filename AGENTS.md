# Exeplanner: contexto para nuevas sesiones

## Plataforma y archivos

- Planificador de entrenamiento sin cuentas ni login para prescriptores y estudiantes. La interfaz esta en espanol.
- Frontend React 19 + Vite. `src/main.jsx` contiene el editor, las vistas compartidas, la conversion de datos y la exportacion PDF con enlace y QR del estudiante.
- `src/styles.css` contiene los estilos. Mantener el lenguaje visual existente y la adaptacion a movil.
- `src/api.js` centraliza las peticiones a rutas `/api/` del mismo origen.
- `src/exercise-library.js` carga bajo demanda el catalogo local `src/data/exercises.json`. Su revision y licencia estan en `src/data/exercises-source.json` y `src/data/exercises.LICENSE.txt`. Los GIF de Gym visual se guardan en `public/exercise-media/videos` y se sirven desde `/exercise-media/videos/`, sin peticiones a GitHub. Aparecen con carga diferida nativa (`loading="lazy"`) y atribucion. Requieren licencia propia, no estan cubiertos por MIT. No se copian a los planes ni al PDF. El Dockerfile del frontend debe copiar `public` antes de compilar.
- Backend Express + MongoDB en `server/index.js`; configura la conexion mediante variables de entorno.
- Rutas: `/` crea una planificacion; `/p/:token` permite editar como prescriptor; `/s/:token` permite consultar y registrar la ejecucion como estudiante.
- `/admin` lista todas las planificaciones con enlaces de prescriptor y estudiante, en paginas de 25. Usa `ADMIN_USERNAME` y `ADMIN_PASSWORD` del backend (`.env` en Compose); sin ambos valores el acceso administrativo queda deshabilitado. Nunca usar variables `VITE_` para estas credenciales.
- El administrador puede eliminar una planificacion con confirmacion mediante `DELETE /api/admin/plans/:id`. El borrado es definitivo e incluye ejecuciones y fechas; ambos enlaces dejan de funcionar.
- `server/admin.js` implementa `/api/admin`: login/logout y listado autenticado mediante cookie HttpOnly, SameSite Strict y Secure en HTTPS. Las sesiones duran 8 horas, residen en memoria y se invalidan al reiniciar el backend. En produccion usar HTTPS; el proxy debe conservar Host con puerto y el protocolo publico en X-Forwarded-Proto.
- `example.json` y `example2.json` son planes importables. `example2.json` incluye una descripcion extensa en "Sentadilla a caja" para probar el resumen expandible.
- `TODO.md` contiene las tareas funcionales. Revisar su estado actual antes de elegir la siguiente.

## Invariantes de datos y comportamiento

- El editor usa `weeks/days/exercises`. La API y los JSON importados/exportados usan `sessions`, con un array `plan` de prescripciones semanales por ejercicio.
- `normalizePlan` y `toSchemaPlan`, en `src/main.jsx`, convierten entre ambos formatos.
- Conservar los identificadores al editar o reordenar. Las ejecuciones se asocian con claves `semana:sesion:ejercicio` y las fechas con `semana:sesion`.
- El orden de sesiones y ejercicios debe ser consistente en todas las semanas, sin perder sus prescripciones individuales. La reordenacion usa asas de arrastre con soporte de puntero y teclado.
- La biblioteca conserva nombres originales e instrucciones en espanol; anadir copia una definicion editable a todas las semanas con un ID local nuevo. Abrir o filtrar el catalogo no modifica el plan ni dispara guardado. El ID del catalogo nunca sustituye al ID local.
- El guardado automatico espera 800 ms despues del ultimo cambio. No publicar un plan vacio al abrir la pagina ni perder las ediciones realizadas durante una peticion en curso.
- El guardado automatico no debe borrar las ejecuciones del estudiante. El guardado manual explicito tiene una logica distinta para resolver sugerencias pendientes; revisar esa distincion antes de modificarla.
- No confundir la persistencia del servidor con almacenamiento local: la persistencia general en localStorage esta desactivada; sessionStorage se usa para transferir planes nuevos o duplicados.
- La vista del estudiante resume descripciones de mas de 180 caracteres y permite expandirlas. El prescriptor y el PDF conservan el texto completo y los enlaces.

## Entorno local y Docker

- Trabajar desde la raiz del repositorio. En Windows PowerShell usar `npm.cmd`, porque la politica de ejecucion puede bloquear `npm.ps1`.
- `http://localhost:8080` sirve el frontend compilado dentro de Docker/Nginx, NO los archivos fuente ni el directorio `dist` del host. Ejecutar solo `npm.cmd run build` no actualiza esa pagina.
- Despues de cambios en el frontend, reconstruir y recrear unicamente ese servicio para probar en el puerto 8080:

```powershell
docker compose up -d --no-deps --build frontend
```

- El Dockerfile del frontend ejecuta `npm ci` y `npm run build`, y copia el resultado a Nginx. `nginx.conf` sirve las rutas SPA y redirige `/api/` a `backend:3001`.
- Para cambios del backend, reconstruir solo el servicio afectado con `docker compose up -d --no-deps --build backend`; comprobar despues la API a traves de Nginx.
- No ejecutar `docker compose down`, eliminar volumenes ni recrear MongoDB para desplegar cambios del frontend/backend. Actualmente el montaje del volumen de MongoDB esta comentado en `docker-compose.yml`: recrear su contenedor puede perder datos.
- Revisar la configuracion Compose y los servicios activos si el entorno difiere; no asumir que los nombres o las imagenes siguen iguales.
- `npm.cmd run dev` inicia Vite como alternativa de desarrollo, pero no actualiza el servicio Docker del puerto 8080.

## Verificacion

```powershell
npm.cmd test
npm.cmd run build
git diff --check
curl.exe --fail -s http://localhost:8080/
curl.exe --fail -s http://localhost:8080/api/health
```

- Las pruebas actuales estan en `src/autosave.test.js`: cubren guardado automatico, reordenacion, controles de arrastre/teclado y descripciones expandibles. Usan un arnes de componentes con API y DOM simulados, no un navegador real ni MongoDB.
- `npm.cmd test` tambien ejecuta `server/admin.test.js`, con peticiones HTTP y una coleccion MongoDB simulada para autenticacion, proteccion de acceso y paginacion; el arnes frontend cubre login, listado, paginacion, logout y caducidad.
- Tras reconstruir Docker, verificar que `/` referencia los assets de la nueva compilacion y que `/api/health` devuelve `ok: true` y `database: true`.
- Una pestana ya abierta necesita recargarse; usar Ctrl+F5 si conserva recursos anteriores.
- Para probar la descripcion extensa, importar el `example2.json` actualizado y abrir el enlace del estudiante. Cambiar el JSON de ejemplo no modifica planes ya guardados.
- Distinguir pruebas automatizadas, compilacion, comprobaciones HTTP y verificacion visual. No afirmar que se ha probado en navegador si no se ha hecho.
- Vite puede advertir de bundles superiores a 500 kB; no confundir esa advertencia con un fallo de compilacion.

## Mantenimiento de este contexto

- Leer los archivos concretos antes de editarlos; este resumen no sustituye comprobar el codigo actual.
- Actualizar este archivo cuando cambien la arquitectura, los comandos o los invariantes importantes. Evitar historiales detallados y resultados de pruebas que queden obsoletos.
- No guardar secretos, contrasenas, tokens ni enlaces privados aqui.
- Respetar cambios existentes del usuario y no crear commits sin peticion explicita.
