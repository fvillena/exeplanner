# Enlace y QR de vista estudiante en PDF

## Contexto

- La exportación PDF está implementada en `src/main.jsx`, dentro de `exportPdf`.
- La vista de estudiante usa la ruta `/student/:token` cuando se accede mediante enlace compartido.
- `PrescriberPlanApp` ya recibe `studentToken` desde la API y construye `studentUrl`, pero actualmente usa `/p/:token`, que corresponde a `PlanAccessView` y no a la ruta explícita de estudiante.
- La aplicación permite descargar el PDF tanto antes como después de publicar el plan. Antes de publicar no existe un token persistido ni un enlace de estudiante válido.
- `jspdf` ya está instalado; no se observa una dependencia de generación de códigos QR.

## Decisiones

- El enlace que se imprimirá debe ser la vista de estudiante real: `${window.location.origin}/student/${studentToken}`.
- El PDF debe incluir el enlace y el QR en la primera página, junto a los datos de la planificación, para que estén disponibles sin recorrer las tablas.
- Si el plan aún no fue publicado y no existe `studentUrl`, el PDF debe conservar su comportamiento actual y omitir el bloque de enlace/QR, mostrando el acceso después de publicar.
- El QR debe codificar exactamente la misma URL visible en el PDF.
- Se recomienda añadir una dependencia pequeña y estable de QR para navegador, generar el código como imagen Data URL y pasarlo a `pdf.addImage`. No se debe depender de una imagen remota ni de un canvas no esperado por `jsPDF`.
- El bloque debe tener texto alternativo visible, por ejemplo `Vista de estudiante`, la URL completa y una indicación breve de escaneo.

## Plan de implementación

1. Corregir la construcción de `studentUrl` en `PrescriberPlanApp` para usar `/student/:token`; revisar también cualquier otro lugar donde se derive el enlace para mantener una única convención.
2. Incorporar el generador QR como dependencia de runtime y actualizar el lockfile mediante el gestor de paquetes del proyecto.
3. Convertir `exportPdf` en una función asíncrona o preparar previamente el Data URL del QR, manteniendo el nombre y la descarga del archivo actuales.
4. Cuando exista `studentUrl`, reservar espacio en la primera página después del encabezado o de los datos principales, dibujar un panel visual consistente con el estilo existente, imprimir la URL con `splitTextToSize` y añadir el QR con tamaño suficiente para lectura al imprimir.
5. Ajustar el flujo de descarga del botón `Descargar PDF` para esperar la generación del QR y manejar errores de generación sin producir un PDF parcialmente corrupto.
6. Revisar el estado de publicación: desde un plan local sin publicar no inventar un token; después de publicar o al abrir un plan de prescriptor, usar el token que ya entrega el servidor.

## Validación

- Ejecutar `npm run build`.
- Descargar un PDF antes de publicar y verificar que se genera sin QR ni URL inválida.
- Publicar un plan, abrir la vista de prescriptor y descargar el PDF; verificar que la URL impresa apunta a `/student/:token`.
- Escanear el QR desde el PDF o desde una captura y confirmar que abre la vista de estudiante correcta.
- Verificar que el QR y el enlace aparecen en la primera página tanto en orientación vertical como horizontal.
- Confirmar que el botón no permite descargas simultáneas o estados ambiguos mientras se genera el QR.

## Riesgos y alcance

- Si se desea que todo PDF tenga siempre un QR, incluso antes de publicar, habría que cambiar el modelo de acceso para generar/publicar el token previamente; queda fuera de este cambio porque no existe un enlace de estudiante válido en ese momento.
- El enlace depende del dominio desde el que se descarga el PDF; para despliegues detrás de proxy se debe verificar que `window.location.origin` sea el dominio público esperado.
