# v5.2.4 — Soporte en Flujo descendente

## Corrección de modo
Las funciones añadidas en v5.2.0–v5.2.3 para contener descensos se habían conectado por error a **Seguir terreno**.

Ahora:

- **Seguir terreno**:
  - Sigue la altura local del relieve.
  - No construye soporte, pozas ni costados especiales.
  - Ignora las opciones de soporte de descensos.

- **Flujo descendente**:
  - Mantiene una cota que nunca sube en la dirección del río.
  - Detecta descensos fuertes.
  - Excava la parte alta.
  - Agrega bloques donde falta terreno en la parte baja.
  - Construye fondo y costados locales como una rampa hidráulica.
  - Evita la lámina o triángulo de agua suspendida.

Los controles de soporte solo se muestran cuando el río está en **Flujo descendente**.

Los ríos antiguos en Flujo descendente que no tenían el campo de soporte lo reciben activado por defecto al abrir el proyecto. Una elección explícita de desactivarlo se conserva.
