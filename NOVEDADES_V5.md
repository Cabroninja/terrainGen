# JKR Terrain Generator v5.0.0

## Rampa natural de meseta

La capa **Altura base** incorpora **Rampa de meseta**. Reutiliza el editor de recorridos y pendientes de las rampas viales, pero modifica únicamente el relieve y nunca pinta la máscara de caminos.

## Resultados acoplables

**Validación y resultados** puede permanecer debajo del lienzo o acoplarse a la derecha como vista dividida real. Ambos modos tienen un separador exterior arrastrable y mantienen el separador interno entre Validación y Resultados.

## Biblioteca central

Los presets y las colecciones `.schem` se almacenan en el servidor bajo `DATA_DIR/library`. Con Docker, el volumen persistente `terrain_data` comparte la biblioteca entre todos los equipos que acceden a la misma instalación.

La versión comienza limpia y no migra información desde `localStorage`.
