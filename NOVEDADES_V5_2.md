# JKR Terrain Generator v5.2.0

## Cascadas contenidas para Seguir terreno

En **Agua → Río libre → Adaptación al relieve → Seguir terreno** se agregaron:

- **Contener cascadas automáticamente**.
- **Detectar cascada desde**, con valor predeterminado de 2 bloques.

La protección solo actúa en caídas detectadas. No crea bordes ni terraplenes a lo largo del resto del río.

Cada cascada contenida genera:

- Una caída vertical localizada.
- Agua fuente únicamente en la parte superior.
- Agua descendente en la columna inferior.
- Paredes laterales sólidas junto a la caída.
- Una pequeña poza inferior redondeada.
- Un anillo de contención únicamente alrededor de la poza.

## Compatibilidad

- Los ríos nuevos usan la contención activada por defecto.
- Los proyectos anteriores mantienen sus ríos sin contención hasta que se editen o se active expresamente la opción.
- El modo **Flujo descendente** no utiliza esta función.

## Validación

La compilación informa:

- Cascadas detectadas.
- Cascadas contenidas correctamente.
- Celdas de caída y de poza.
- Advertencias si una cascada cruza un camino protegido.
- Advertencias si una cascada toca el borde sin una salida autorizada.

## Verificación

- 74 pruebas automatizadas superadas.
- Sintaxis Python y JavaScript validada.
- 222 IDs de interfaz, sin duplicados.
