# JKR Terrain Generator v5.3.2 — Inclinación de cascadas

## Nuevo parámetro
En **Agua → Río libre** se agregó **Inclinación de cascada**:

- **Vertical (comportamiento actual)**: conserva exactamente la caída anterior.
- **Leve 1:8**: pequeño retroceso dentro de la meseta.
- **Suave 1:6**: excavación moderada.
- **Natural 1:4**: caída inclinada y equilibrada.
- **Profunda 1:2**: introduce más la garganta dentro de la meseta.

## Comportamiento
- Solo modifica las cascadas automáticas.
- No altera el cauce normal ni el recorrido dibujado.
- El sistema excava una garganta corta y empinada dentro de la meseta.
- Mantiene la alcoba erosionada, los costados de contención y la poza inferior.
- Los proyectos anteriores usan **Vertical** por defecto.

## Instalación
Desde la raíz del proyecto:

```bash
unzip -o JKR-Terrain-Generator-v5.3.2-INCLINACION-CASCADA-PARCHE.zip
docker compose up -d --build
```

Después recarga con `Ctrl + F5`, edita el río, elige la inclinación, aplica los cambios y vuelve a compilar.
