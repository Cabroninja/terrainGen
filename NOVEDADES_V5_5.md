# JKR Terrain Generator v5.5.0 — Mesetas editables

## Qué cambia
La herramienta **Altura base** conserva los mismos parámetros de meseta y añade únicamente la posibilidad de seleccionar una meseta creada con esta versión para volver a aplicarlos:

- Altura de la meseta.
- Radio de la meseta.
- Anchura de la pendiente.
- Generar soporte exterior.
- Anchura del soporte.
- Altura del soporte.

No se añadieron parámetros nuevos a la geometría de las mesetas.

## Uso
1. Crea una meseta normalmente con **Pintar meseta**.
2. Cambia a **Seleccionar meseta**.
3. Haz clic sobre la meseta.
4. Modifica cualquiera de los parámetros existentes.
5. Pulsa **Aplicar cambios** o compila directamente.

La meseta se reconstruye desde su base, por lo que al reducir su altura, radio o soporte no quedan restos de la forma anterior.

## Compatibilidad
Las mesetas creadas antes de esta actualización permanecen integradas en la capa de altura porque los proyectos antiguos no conservaban su trazo ni sus parámetros originales. Las mesetas creadas a partir de v5.5.0 sí se guardan como objetos editables dentro del proyecto.
