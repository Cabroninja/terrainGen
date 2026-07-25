# JKR Terrain Generator v5.3.1 — Cascadas sin efecto de cilindro

## Corrección aplicada
Se ajustó el modelado de los costados de las cascadas automáticas para eliminar la apariencia de "cáscara de cilindro" o tubo cortado que quedaba visible alrededor de la caída.

### Ahora el sistema:
- Forma un **alvéolo/alcoba erosionada** alrededor de la cascada.
- Mezcla la roca de los costados con **alturas intermedias**, en vez de levantar una pared curva uniforme a la altura superior.
- Conserva soporte local suficiente para contener el agua.
- Mantiene la poza inferior y la cortina de agua automática.

## Archivos incluidos
- `app/terrain/water_courses.py`
- `tests/test_water_courses.py`

## Instalación
Desde la raíz del proyecto:

```bash
unzip -o JKR-Terrain-Generator-v5.3.1-CASCADA-ALCOBA-PARCHE.zip
docker compose up -d --build
```

Luego recarga con `Ctrl + F5` y vuelve a compilar el mapa.
