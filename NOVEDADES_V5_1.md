# Novedades v5.1.0 — Ríos con adaptación al relieve

## Nueva opción en la herramienta de Río libre
Se agregó el selector **Adaptación al relieve** con dos modos:

- **Seguir terreno**
  - El río acompaña el relieve local.
  - Evita el efecto bulldozer sobre mesetas intermedias.
  - Recomendado para ríos naturales del mapa.

- **Flujo descendente**
  - Conserva el comportamiento clásico.
  - La superficie del agua nunca sube en la dirección del flujo.
  - Puede excavar elevaciones intermedias si el recorrido lo requiere.

## Compatibilidad
- Los proyectos antiguos siguen cargando.
- Los ríos antiguos que no tengan este campo se interpretan como **Flujo descendente** para no cambiarles el comportamiento al abrirlos.
- Los ríos nuevos usan por defecto **Seguir terreno**.
