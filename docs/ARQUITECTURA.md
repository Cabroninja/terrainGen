# Arquitectura paint-first

El proyecto se divide en tres responsabilidades que no se mezclan:

1. **Editor** (`app/static/`): modifica capas uint8, marcadores, rampas, cursos de agua y colocaciones de estructuras. No hornea bloques en las capas.
2. **Compilador** (`app/terrain/`): convierte intención pintada en heightmap, pendientes, materiales y validación.
3. **Exportadores** (`app/exporters/`): generan PNG, datos de previsualización 3D, JSON y Sponge Schematic v3 desde un terreno ya compilado.

## Capas obligatorias

- `playable`: límite jugable, 0–255.
- `regions`: identificador de región, 0–255.
- `roads`: 0 vacío, 1 principal, 2 secundario.
- `height_base`: altura normalizada, 0–255.
- `height_modifier`: desplazamiento centrado en 128.
- `water`: máscara 0–255.
- `reserved`: máscara lógica de zonas reservadas; no modifica alturas durante la compilación.
- `materials`: 0 automático y códigos manuales.
- `exclusion`: reserva para decoración futura.

Las capas se guardan con RLE `rle-u8`, por lo que el proyecto conserva los datos editables y no solamente el resultado final.

## Coordenadas

- Una celda interna equivale a una columna de Minecraft.
- X corresponde al ancho.
- Z corresponde al largo.
- Los mapas pueden ser rectangulares.
- X y Z deben ser múltiplos de 16 y estar entre 32 y 2048.

## Orden de compilación

1. Decodificar capas.
2. Convertir altura base y modificador a bloques.
3. Aplicar únicamente las rampas viales explícitas y fusionar su máscara de camino.
4. Guardar el perfil previo a la cordillera para calcular cursos de agua sobre mesetas y rampas.
5. Generar el borde montañoso y resolver sus corredores viales.
6. Aislar la cordillera a su máscara para impedir difusión sobre el interior.
7. Compilar masas pintadas y objetos `water_courses`; las salidas pueden excavar únicamente su corredor hasta el borde.
8. Aplicar las políticas de cruce vial y obtener superficie de agua, orillas, vados y cortes.
9. Calcular pendiente y transitabilidad; caminos y zonas reservadas comunes no modifican altura.
10. Resolver materiales automáticos y overrides.
11. Resolver las instancias de estructuras sobre la altura final y crear la paleta dinámica de bloques.
12. Validar margen, salidas, componentes viales, escalones, agua, estructuras y marcadores.
13. Exportar imágenes, datos 3D y, opcionalmente, `.schem`.


## Objetos de rampa vial

`road_ramps` es una lista opcional del documento de proyecto. Cada objeto contiene identificador, etiqueta, tipo de camino, recorrido de 2–64 puntos, ancho central, transición lateral, relación mínima de pendiente y descansos. `app/terrain/road_ramps.py` calcula la distancia y el progreso sobre la polilínea, interpola la cota longitudinal y mezcla lateralmente con el heightmap previo.

El recorte es estricto: solo se modifica la distancia `width / 2 + shoulder_width` respecto del recorrido. La máscara central se fusiona con `roads`, por lo que validación, materiales, vista voxel y schematic consumen un único resultado compilado. Los caminos pintados comunes nunca llaman a este módulo.

## Objetos de agua

`water_courses` es una lista opcional del proyecto. Cada río contiene un eje libre de 2–512 muestras, ancho, profundidad, orilla, perfil, política vial, suavizado y una posible salida. `app/static/water-course-tool.js` simplifica y suaviza el trazo del puntero; `app/terrain/water_courses.py` calcula distancia y progreso sobre la polilínea, muestrea el relieve previo a la montaña y produce un nivel superficial por celda que nunca asciende en la dirección del flujo.

La máscara `water` continúa representando masas pintadas. Estas usan el nivel global del proyecto, mientras los ríos usan niveles variables. El compilador devuelve `water_mask`, `water_surface`, `shore_mask`, `ford_mask`, `road_cut_mask` y `water_exit_mask`. Los exportadores consumen estas matrices compartidas para que el resultado sea idéntico en WebGL, voxel y schematic.

Una salida extiende el último segmento hasta el límite físico y convierte su centro en zona exportable aunque cruce la franja no jugable de la cordillera. El recorte lateral siempre es estricto.

## Objetos de estructuras

`structure_assets`, `structure_collections` y `structure_placements` son listas opcionales del proyecto. No existe una matriz RLE adicional para Estructuras:

- Un **asset** guarda metadatos, punto de apoyo y el `.schem` original codificado en base64.
- Una **colección** agrupa assets con pesos relativos y categoría Árboles o Rocas.
- Una **colocación** referencia colección/asset y guarda X/Z, rotación, reflejo y hundimiento.

`app/structures/schematic_reader.py` interpreta Sponge Schematic v2/v3, tanto gzip como NBT sin comprimir. La importación ignora aire, conserva estados de bloque y detecta inicialmente el apoyo en el centro horizontal del nivel sólido inferior. La interfaz permite corregir X/Y/Z.

`app/structures/placement.py` toma la altura compilada de cada punto X/Z, aplica hundimiento y transforma posición y estados orientables en rotaciones de 90°. Los bloques se almacenan de manera dispersa por Y; el terreno no se modifica. Una colocación posterior puede reemplazar bloques estructurales anteriores cuando se superponen, comportamiento intencional para población densa.

La paleta base del terreno se amplía dinámicamente con los estados importados. `blocks.py`, el schematic y la fuente voxel consumen esa misma paleta. En voxel, cada chunk mantiene un archivo disperso de estructuras y el endpoint carga también los chunks vecinos necesarios para el halo de render.

El pincel de población es una operación del editor. La separación se calcula entre apoyos y puede ser cero; las cajas de los schematics no se usan como bloqueo. Las restricciones de agua, caminos/rampas y zonas reservadas se evalúan antes de crear cada instancia y nunca modifican el terreno.

## Vista 3D

La vista 3D nunca recompila ni modifica capas. Consume `*_terrain3d.json`, generado desde `CompiledTerrain`. En proyectos grandes, el exportador muestrea la malla visual hasta 161 puntos por eje e incluye siempre los bordes. Esta reducción solo afecta WebGL; las imágenes, validación y schematic mantienen resolución completa.

## Módulo de borde montañoso

`app/terrain/mountain_border.py` recibe el heightmap previo, la máscara jugable, la configuración y los marcadores. Calcula distancias interiores/exteriores, crea un perfil de cordillera y devuelve:

- heightmap derivado;
- intensidad protegida del borde;
- máscara de corredores;
- salidas resueltas contra el contorno;
- incidencias de validación.

El editor nunca escribe esta montaña en `height_base`. Al modificar el límite o una salida, la siguiente compilación parte otra vez de las capas originales.

El filtro gaussiano utilizado para construir una base montañosa estable queda limitado a las celdas con `strength > 0` o influencia de corredor. El compilador aplica además una barrera defensiva: toda celda fuera de esas máscaras conserva exactamente la altura previa al módulo. Esto impide que una meseta central se difunda y levante el suelo alrededor.


## Vista voxel Minecraft

La compilación persiste, dentro de cada trabajo temporal, matrices NumPy compactas de altura, material, agua y máscara jugable. El manifiesto `*_voxel3d.json` describe dimensiones, paleta y URL de chunks.

El navegador solicita sectores de 16×16 mediante `/api/voxel/{job_id}/{chunk_x}/{chunk_z}`. Cada respuesta incluye un halo de una celda para calcular caras expuestas en límites de chunk sin depender del orden de carga.

Las reglas de bloque viven en `app/exporters/blocks.py` y son compartidas por el schematic y la vista voxel. Así, bedrock, piedra, subsuelo, bloque superior y agua no se calculan mediante dos implementaciones distintas en el backend.

El visor solo construye caras visibles y descarga o descarta chunks según la cámara. El mapa editable y el `.schem` conservan siempre la resolución completa.

## Herramienta de mesetas de Altura base

La capa `height_base` sigue almacenándose como `uint8`, pero la interfaz v2.6 la edita mediante una herramienta absoluta. El módulo `app/static/plateau-tool.js` convierte la cota Y a valor de capa y calcula una única influencia radial:

1. `distance <= plateauRadius`: influencia 1 y altura plana.
2. `plateauRadius < distance < plateauRadius + slopeWidth`: transición smoothstep hacia el valor que tenía la celda al comenzar el trazo.
3. Fuera del radio total: influencia 0.

El trazo conserva el valor inicial por celda y la mayor influencia alcanzada, por lo que pasar nuevamente sobre el mismo rastro sin soltar el clic no acumula altura. El perfil avanzado anterior queda aislado en `height_modifier`.


## Rampas viales y costados

Las rampas son objetos explícitos aplicados después de Altura base y Modificador. El corredor central recibe el perfil longitudinal exacto. Los costados pueden usar una transición fija o un perfil adaptativo calculado desde el desnivel, la pendiente lateral 1:X, la redondez y un límite duro. Los caminos pintados normales nunca modifican alturas.
