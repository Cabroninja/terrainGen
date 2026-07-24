# JKR Terrain Generator v3.3.0

Reconstrucción completa del generador de terrenos tipo Albion para Minecraft, centrada en un flujo **paint-first**.

La interfaz ya no pinta bloques directamente. Pinta capas independientes y el backend las compila después. Esto permite mover caminos, retocar alturas o cambiar agua sin reparar manualmente efectos secundarios antiguos.

## Qué incluye

- Editor web por capas.
- Mapas cuadrados o rectangulares.
- Dimensiones rápidas y personalizadas entre 32 y 2048, siempre múltiplos de 16.
- Presets reutilizables para pincel, compilación y borde montañoso.
- Herramienta simple de `Altura base`: altura Y absoluta, radio plano, pendiente y soporte exterior opcional.
- Dos círculos normales para mesetas y un tercer círculo verde solo cuando el soporte exterior está activo.
- Pincel avanzado conservado en `Modificador de altura` para retoques artísticos.
- Altura schematic configurable entre 64 y 320.
- Capas de límite, regiones, caminos, altura base, modificador, agua, zonas reservadas, materiales y exclusión.
- Pincel circular/cuadrado, dureza, opacidad, fuerza, trazo libre y línea recta.
- Las mesetas de Altura base nunca acumulan intensidad durante el mismo clic; el Modificador mantiene su opción de acumulación.
- Herramientas específicas según la capa.
- Relleno de áreas para máscaras y categorías.
- Marcadores de spawn, salidas y puntos de interés.
- Historial deshacer/rehacer.
- Guardado y apertura `.jkrterrain.json` con RLE.
- Zoom 25–400%, cuadrícula por chunks y vista compuesta o técnica.
- Tooltips técnicos y simples en todos los campos donde se introducen valores.
- Tooltips propios para cada capa, explicando qué guarda, qué modifica y sus reglas importantes.
- Compilador de relieve separado de la interfaz.
- Caminos pintados y zonas reservadas puramente lógicos: no suavizan ni levantan el terreno durante la compilación.
- Rampas viales explícitas, editables y limitadas a su corredor, con ancho, pendiente longitudinal, descansos y costados opcionalmente suavizados.
- Suavizado lateral profesional con pendiente 1:X, anchura máxima, redondez y adaptación al terreno, sin deformar el centro transitable.
- Generador automático de borde montañoso desde la capa Límite jugable.
- Margen exterior automático, cordillera reproducible y corredores de salida protegidos.
- Guía del contorno directamente sobre el lienzo.
- Herramienta de agua reconstruida: masas a pincel y ríos libres suavizados, editables y con altura por celda.
- Ancho, profundidad, orilla, perfil de ribera, política de cruce vial y salidas de agua entre montañas.
- Nueva capa virtual **Estructuras** para poblar árboles y rocas desde colecciones de archivos Sponge `.schem`.
- Pincel libre de población con diámetro, cantidad hasta 200%, separación mínima desde 0, rotación/reflejo aleatorios y hundimiento.
- Colecciones con variantes ponderadas, punto de apoyo editable, sello individual y pincel de borrado.
- Las estructuras se guardan como instancias editables y se convierten en bloques reales tanto en Vista Minecraft como en la exportación final.
- Validación de salidas, componentes de camino, saltos y transitabilidad.
- Vistas PNG: terreno, altura, pendiente y transitabilidad.
- Botón para generar una semilla aleatoria válida y reproducible.
- Vista 3D WebGL del terreno compilado, con órbita, zoom, desplazamiento, exageración vertical, agua, marcadores, malla opcional y modo ampliado.
- Vista Minecraft voxel por chunks de 16×16, con bloques exactos del schematic, bordes, agua, corte Y, órbita, primera persona y distancia de render de hasta 16 chunks.
- Exportación Sponge Schematic v3 `.schem`.
- Límite preventivo de 750 millones de vóxeles por exportación, con advertencia desde 250 millones y escritura por capas.

Los presets se conservan en el almacenamiento local del navegador para la misma dirección desde la que abres el editor. No alteran el archivo del proyecto hasta que cargas un preset de compilación o de borde y guardas el mapa.

## Inicio con Docker

```bash
docker compose up -d --build
```

Abrir:

```text
http://localhost:8080
```

## Inicio local

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

En Windows PowerShell, la activación es:

```powershell
.venv\Scripts\Activate.ps1
```

## Flujo recomendado

1. Crear el proyecto y elegir dimensiones.
2. Pintar el límite jugable y las regiones.
3. Activar **Borde montañoso** y usar **Preparar margen automático** cuando el proyecto todavía ocupe todo el lienzo.
4. Pulsar **Salida** y hacer un clic cerca del sector deseado; el marcador se ajustará al contorno jugable y aparecerá también en la lista con sus coordenadas.
5. Pintar la red principal y secundaria; cuando un acceso deba subir a una meseta, crear una **Rampa vial** explícita.
6. Pintar zonas reservadas para bosses, campamentos o estructuras.
7. En **Altura base**, elegir la cota Y, el radio plano y la anchura de pendiente; luego pintar las mesetas directamente.
8. Retocar irregularidades con **Modificador de altura**.
9. En **Agua**, pintar lagos con **Masa de agua** o mantener clic para dibujar un **Río libre**; marcar como salida cuando deba perderse entre montañas.
10. En **Estructuras**, crear una colección, importar variantes `.schem` y poblar árboles o rocas con el pincel libre.
11. Compilar la vista, revisar la cordillera en **Vista 3D** y comprobar agua, rampas y estructuras en **Vista Minecraft**.
12. Guardar el proyecto editable y exportar el `.schem`.


## Herramienta simple de mesetas

`Altura base` ya no utiliza fuerza, opacidad ni dureza. Tiene tres controles principales y un soporte exterior opcional:

- **Altura de la meseta (Y):** cota absoluta de la superficie.
- **Radio de la meseta:** tamaño de la zona completamente plana.
- **Anchura de la pendiente:** distancia usada para conectar la meseta con el terreno que existía al comenzar el trazo.

El cursor muestra dos círculos con el soporte apagado:

- Amarillo: superficie plana.
- Blanco: final exacto de la pendiente.

Al activar **Generar soporte exterior** aparece además:

- Verde: final exacto de la falda exterior.

El soporte tiene **Anchura** y **Altura** independientes. La anchura controla cuánto se extiende el césped y la altura controla cuánto se levanta junto a la meseta. Fuera del último círculo visible no se modifica ninguna celda. Al arrastrar, los perfiles forman una superficie continua y no se acumulan al repasar durante el mismo clic.

**Tomar del terreno** permite copiar la altura base de una coordenada y extender una plataforma existente. La acción **Restaurar altura media** devuelve la zona hacia el valor neutro de Altura base usando la misma pendiente.

El perfil avanzado anterior permanece únicamente en `Modificador de altura`, donde sigue siendo útil para detalles, irregularidades y retoques.


## Rampas viales explícitas

La capa **Caminos** conserva dos herramientas independientes:

- **Pintar camino:** solo aplica el material principal o secundario sobre la altura existente.
- **Crear o editar rampa:** construye una subida real entre el primer y el último punto del recorrido.

Para crear una rampa, selecciona Caminos, cambia a **Crear o editar rampa**, haz clic en el punto bajo, añade puntos intermedios cuando necesites curvas y termina sobre la meseta. La herramienta muestra longitud, alturas inicial/final, desnivel, pendiente real y si el recorrido cumple la relación mínima elegida.

Controles:

- **Ancho transitable:** corredor central con altura uniforme transversal y material de camino.
- **Transición lateral:** mezcla explícita entre el borde del camino y el terreno original. Fuera de esta franja no cambia ninguna altura.
- **Pendiente máxima 1:X:** exige X bloques horizontales por cada bloque vertical.
- **Descanso inferior/superior:** tramos planos antes y después de la subida.

Las rampas se guardan como objetos `road_ramps` dentro del proyecto. Pueden seleccionarse, editarse, borrarse y regenerarse al compilar. Sus alturas de inicio y fin se leen nuevamente desde el terreno, por lo que una rampa se adapta si después cambias la meseta. Los proyectos anteriores, que no contienen `road_ramps`, se abren con una lista vacía.

## Agua a pincel y ríos libres

La capa **Agua** tiene dos modos independientes:

- **Masa de agua:** pincel circular para lagos, lagunas y estanques. La máscara pintada usa un nivel superficial global, pero su profundidad, anchura de orilla y perfil son configurables.
- **Río libre:** mantén clic y dibuja el recorrido directamente sobre el mapa. El editor limpia el temblor del mouse, suaviza el eje y lo guarda como un objeto `water_courses` que puede seleccionarse, editarse o eliminarse.

Los controles compartidos son **Ancho**, **Profundidad**, **Anchura de la orilla** y perfil **Compacta / Natural / Suave**. En un río, la superficie se calcula por celda desde la cota alta hacia la baja y puede seguir mesetas y rampas sin quedar limitada al nivel global de los lagos. Aunque el trazo se dibuje desde abajo, el compilador invierte el flujo cuando corresponde.

Al cruzar caminos se puede elegir:

- **Proteger camino:** mantiene seco el corredor vial.
- **Crear vado:** conserva el bloque de camino y coloca un bloque de agua encima.
- **Cortar camino:** el cauce elimina la máscara vial en la intersección.

La opción **Final como salida entre montañas** prolonga el último tramo en su dirección hasta el límite del mapa. El cauce abre únicamente su corredor en la cordillera y el agua continúa fuera del área jugable, evitando un final abrupto. Fuera de `ancho / 2 + orilla` el río no modifica ninguna celda.

Las masas pintadas y los ríos guardados mantienen configuraciones separadas en la interfaz: editar un río no cambia silenciosamente la profundidad ni la orilla de los lagos. El nivel por celda se comparte entre Vista 3D, Vista Minecraft y `.schem`.

## Pincel de árboles y rocas

La capa virtual **Estructuras** no pinta una matriz de bloques. Guarda colecciones, schematics importados e instancias X/Z que se apoyan sobre el terreno final durante cada compilación. Esto permite cambiar posteriormente una meseta, una rampa o una orilla sin volver a poblar: las estructuras conservan su posición horizontal y recalculan su altura.

Flujo básico:

1. Crear una colección de categoría **Árboles** o **Rocas**.
2. Importar uno o varios archivos Sponge `.schem`. El archivo queda embebido dentro del proyecto editable.
3. Ajustar el peso de cada variante y, cuando sea necesario, corregir su punto de apoyo X/Y/Z.
4. Elegir **Poblar**, configurar el diámetro, cantidad, separación, rotación, reflejo y hundimiento.
5. Mantener clic y arrastrar libremente. Toda la pasada se registra como una sola acción de deshacer.

Herramientas disponibles:

- **Poblar:** distribuye variantes ponderadas dentro del pincel.
- **Colocar una:** aplica una sola variante por clic.
- **Borrar estructuras:** elimina instancias dentro del pincel sin modificar el terreno.

La **Separación mínima** se mide entre puntos de apoyo, no entre las cajas completas. Con separación `0`, árboles y rocas pueden tocarse o superponerse, útil para bosques densos y grandes formaciones rocosas. **Cantidad** admite hasta `200%` para aumentar el número de intentos de colocación.

Las opciones avanzadas permiten evitar agua, caminos/rampas y zonas reservadas. Son restricciones explícitas y pueden desactivarse. El hundimiento coloca la base algunos bloques dentro del terreno; normalmente se usa `0–1` para árboles y `1–3` para rocas.

La rotación utiliza pasos de 90° y transforma también los estados orientables más comunes de Minecraft. El reflejo es opcional. Los bloques de aire del schematic no se colocan, por lo que no borran el terreno ni otras estructuras.

Vista Minecraft carga los bloques estructurales por chunks y la exportación `.schem` utiliza la misma paleta dinámica. Los proyectos anteriores se abren con biblioteca y lista de instancias vacías.

## Compilación sin ajustes ocultos

Desde v2.7.0, pintar caminos o zonas reservadas no cambia la altura del terreno. El compilador ya no crea hombros, halos ni montículos automáticos alrededor de esas máscaras. Los campos antiguos `road_fit_width` y `reserved_fit_width` se mantienen únicamente para poder abrir proyectos anteriores y se ignoran.

La falda verde alrededor de una meseta solo puede aparecer al activar **Generar soporte exterior** en `Altura base`. Desde v2.9.0, la cordillera suma su relieve celda por celda sobre el terreno original y nunca desenfoca alturas vecinas. Una meseta no puede levantar césped fuera de su círculo blanco, incluso cuando está dentro de la transición interior del borde montañoso.

## Colocación de marcadores

- Pulsa **Spawn**, **Salida** o **Punto de interés** para activar la herramienta.
- Antes del clic se muestra un círculo discontinuo de previsualización.
- Las salidas se ajustan al contorno real de `Límite jugable`; ya no se ocultan en el borde físico del canvas.
- Después del clic aparece un círculo de alto contraste y una entrada en la lista lateral con tipo, X y Z.
- Pulsa `Esc` cuando termines de colocar marcadores.
- La creación de IDs tiene fallback compatible con accesos mediante `http://IP:puerto`, donde `crypto.randomUUID()` puede no estar disponible.

## Formato del proyecto

El archivo editable contiene configuración, marcadores y nueve capas RLE. No depende del resultado compilado. Consulta `docs/ARQUITECTURA.md`.

## Pruebas

```bash
pytest -q
```


## Uso de la vista 3D

- Arrastrar: rotar la cámara.
- `Shift` + arrastrar: desplazar el punto de enfoque.
- Rueda del ratón: acercar o alejar.
- **Relieve**: exageración visual del eje Y; no modifica el proyecto ni el schematic.
- **Malla**: muestra los polígonos usados por la previsualización.
- **Recentrar**: restaura la cámara inicial.
- **Ampliar**: ocupa casi toda la ventana; **Cerrar** o `Esc` restaura el panel.

En mapas grandes, solo la malla visual se muestrea hasta aproximadamente 161 puntos por eje para mantener fluidez. La compilación y el schematic conservan la resolución completa.

## Borde montañoso

El borde es un resultado compilado, no una capa destructiva. Su filtro de suavizado se aplica únicamente donde existe influencia del borde o de un corredor de salida. Fuera de esa máscara, el compilador restaura exactamente el relieve pintado y no permite que una elevación central se propague.

Se calcula desde `playable` usando distancia al contorno, ruido reproducible y la semilla del proyecto. Los marcadores `exit` abren corredores con laterales montañosos y transición longitudinal.

Configuración inicial recomendada para 256×256:

```text
Anchura exterior: 32
Transición interior: 18
Altura del borde: 38
Irregularidad: 45%
Rugosidad: 35%
Anchura de salidas: 14
Adaptación de salidas: 36
```

Los proyectos v2.0/v2.1 siguen siendo compatibles. Al abrirlos, el borde automático permanece desactivado hasta que el usuario lo habilite.

## Acumulación de altura

La herramienta de mesetas de **Altura base** es absoluta y no acumulativa: repasar una celda sin soltar el clic no vuelve a elevarla. Conserva el terreno que existía al comenzar el trazo y usa únicamente la mayor influencia alcanzada.

La opción **Acumular intensidad** permanece en **Modificador de altura** para quien necesite construir retoques progresivos.

### Vista Minecraft bloque a bloque

Después de **Compilar vista**, abre la pestaña **Vista Minecraft**. La previsualización carga chunks de 16×16 alrededor de la cámara y reconstruye las caras visibles con los mismos bloques del exportador `.schem`.

- **Órbita:** arrastrar para rotar, Shift+arrastrar para desplazar y rueda para zoom.
- **Primera persona:** clic sobre el visor, WASD para moverse, Espacio/Shift para subir o bajar y rueda para cambiar velocidad.
- **Corte vertical:** baja el valor Y para inspeccionar tierra, piedra y estratos internos.
- **Bordes de bloque:** permite ver con claridad cada escalón real de Minecraft.
