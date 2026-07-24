# Rediseño de interfaz v4

Este paquete reconstruye la interfaz visual del editor sin modificar la lógica de generación del terreno, compilación, exportación ni las herramientas especializadas.

## Archivos de interfaz modificados

- `app/static/index.html`
- `app/static/styles.css`
- `app/static/config-help.js`
- `app/static/ui-shell.js` (nuevo)

## Estructura nueva

- Barra superior compacta para abrir, guardar, compilar y exportar.
- Lienzo central dominante.
- Inspector acoplado con Capas y Marcadores.
- La capa activa continúa definiendo su conjunto de herramientas.
- Herramientas, Entorno y Compilación se organizan en pestañas independientes.
- Configuración del proyecto en un panel lateral.
- Validación, resultados, vistas 3D/Minecraft y descargas en un panel inferior.
- Todos los paneles siguen disponibles en resoluciones pequeñas mediante overlays; ninguno se elimina por CSS.
- Selectores principales convertidos visualmente en botones segmentados, manteniendo el `<select>` original como fuente de estado.

## Ayuda contextual

- Se conserva el registro existente de `config-help.json`.
- Los tooltips aparecen sobre etiquetas, campos, selectores y botones.
- Los controles creados dinámicamente también reciben ayuda mediante un observador de interfaz.
- Los tooltips no bloquean el clic sobre controles o sobre el lienzo.
- `F1` abre la ayuda del campo enfocado y `Escape` cierra paneles o ayuda contextual.

## Validación realizada

- Se conservaron los 198 identificadores originales de la interfaz.
- No existen IDs duplicados.
- Los 65 tests del proyecto pasan.
- Se verificó en navegador el cambio entre las 10 capas, herramientas de meseta, caminos, agua, estructuras y pincel estándar.
- Se verificaron deshacer, rehacer, panel de proyecto, pestañas de entorno/compilación, panel de resultados y tooltips.
- Se comprobó el layout en 1920×1080, 1366×768 y 800×800.
