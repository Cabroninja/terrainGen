# Changelog

## 3.3.0

- Añadida la capa virtual **Estructuras**, independiente de las matrices RLE de terreno.
- Biblioteca de colecciones para árboles y rocas con importación de múltiples Sponge `.schem`.
- Cada variante admite peso de aparición y punto de apoyo X/Y/Z editable.
- Nuevo pincel libre **Poblar** con diámetro, cantidad 5–200%, separación 0–128, hundimiento, rotación y reflejo aleatorios.
- Separación `0` permite bosques densos y rocas parcialmente superpuestas.
- Añadidos modos **Colocar una** y **Borrar estructuras**, compatibles con deshacer/rehacer por pasada.
- Restricciones opcionales para evitar agua, caminos/rampas y zonas reservadas.
- Los archivos importados quedan embebidos en el proyecto y las colocaciones se guardan como instancias editables.
- Altura de cada instancia recalculada sobre el terreno final al compilar.
- Lectura Sponge Schematic v2/v3 comprimida o sin comprimir, con límites preventivos de tamaño.
- Rotación por cuartos de vuelta, reflejo y transformación de estados orientables comunes.
- Vista Minecraft y exportador `.schem` comparten la misma paleta dinámica y los mismos bloques estructurales.
- Fuente voxel dispersa por chunks para evitar convertir bosques completos en JSON monolítico.
- API de importación `/api/structures/import` y dependencia `python-multipart`.
- 65 pruebas automáticas aprobadas.

## 3.2.0

- Herramienta **Agua** reconstruida con dos modos: Masa de agua a pincel y Río libre.
- Los ríos se dibujan manteniendo clic, se simplifican y suavizan internamente y quedan guardados como objetos editables `water_courses`.
- Ancho del cauce, profundidad, anchura de orilla y perfiles Compacta, Natural y Suave.
- Superficie de agua por celda para seguir mesetas y rampas desde la cota alta hacia la baja.
- Inversión automática del flujo cuando el usuario dibuja un río desde abajo hacia arriba.
- Políticas de cruce vial: Proteger camino, Crear vado y Cortar camino.
- Salida explícita de agua que prolonga el último tramo hasta el borde y abre un corredor entre montañas.
- Configuración de masas separada de la edición de ríos para evitar cambios ocultos.
- Vista 3D, Vista Minecraft y schematic consumen el mismo nivel de agua variable.
- Material de orilla limitado a la máscara real de cada masa o río.
- 61 pruebas automáticas.

## 3.1.0

- Tooltips completos para todos los campos y acciones de la herramienta Rampa vial.
- Vista Minecraft ampliada de 1–8 a 1–16 chunks de distancia de render, con preferencia persistente.
- Nueva opción **Suavizar costados de la rampa**.
- Pendiente lateral 1:X para calcular el alcance según el desnivel real.
- Anchura lateral máxima como límite duro de modificación.
- Redondez lateral de 0–100% para mezclar caída lineal y perfil smootherstep.
- Opción **Adaptarse al terreno** para usar desniveles locales o un perfil transversal más uniforme.
- El ancho transitable y la pendiente longitudinal permanecen intactos.
- Proyectos v3.0.0 compatibles: sus rampas conservan el perfil lateral fijo hasta que se editen.
- 50 pruebas automáticas.

## 3.0.0

- Nueva herramienta **Rampa vial** separada del pincel de caminos.
- Recorridos rectos o curvos mediante 2–64 puntos.
- Alturas inicial y final tomadas automáticamente del relieve y de las mesetas.
- Ancho transitable, transición lateral, pendiente máxima 1:X y descansos configurables.
- Validación de longitud mínima antes de guardar y durante la compilación.
- Las rampas se almacenan como objetos editables `road_ramps`; los proyectos anteriores siguen siendo compatibles.
- La máscara de camino de cada rampa se genera automáticamente y utiliza el mismo material en la Vista Minecraft y el schematic.
- Ninguna celda fuera del corredor central y su transición lateral puede ser modificada por una rampa.
- Lista para seleccionar, editar, eliminar, deshacer y rehacer rampas.
- 46 pruebas automáticas.

## 2.9.0

- Aislamiento estricto entre mesetas y borde montañoso.
- La cordillera ya no desenfoca la capa de altura para calcular su base.
- Una meseta dentro de la transición montañosa no eleva ninguna celda exterior a su huella.
- Los corredores de salida usan una envolvente baja que ignora picos y mesetas cercanas.
- Prueba regresiva comparativa con/sin meseta dentro de la máscara montañosa.

## 2.8.0

- Corregido el halo o terraplén verde que aparecía alrededor de mesetas con soporte exterior desactivado.
- La causa era el suavizado gaussiano del borde montañoso, que se calculaba globalmente y podía difundir una meseta alta hacia el terreno interior.
- El suavizado del borde ahora solo participa dentro de la máscara real de influencia montañosa.
- Nueva barrera defensiva en el compilador: fuera del borde y de los corredores de salida se conserva exactamente `Altura base + Modificador`.
- Con pendiente 0 y soporte exterior apagado, una meseta termina en el radio amarillo/blanco sin levantar césped adicional.
- Añadida una prueba integral con una meseta alta en el centro y borde montañoso activo para impedir regresiones.

## 2.7.0

- Nuevo **Soporte exterior** opcional dentro de la herramienta de mesetas.
- Controles independientes de anchura y altura del soporte para dominar el montículo verde alrededor de la meseta.
- Tercer círculo verde visible únicamente cuando el soporte está activo.
- Con el soporte apagado, el círculo blanco vuelve a ser el límite absoluto de modificación.
- Caminos y zonas reservadas dejan de aplanar, suavizar o levantar el terreno durante la compilación.
- Eliminados de la interfaz los controles de ajuste automático de caminos y zonas reservadas.
- Los campos antiguos siguen aceptándose al abrir proyectos previos, pero quedan obsoletos y sin efecto.
- Nuevas pruebas que garantizan que solo el pincel de meseta puede generar la falda exterior.

## 2.6.0

- `Altura base` reconstruida como herramienta específica de mesetas.
- Altura Y absoluta, radio de superficie plana y anchura de pendiente como únicos controles principales.
- Dos guías bajo el cursor: círculo amarillo para la meseta y círculo blanco para el final de la pendiente.
- Trazos absolutos y no acumulativos durante un clic mantenido.
- Botón **Tomar del terreno** para copiar una altura base existente.
- Acción **Restaurar altura media** con la misma transición configurable.
- El pincel avanzado de tres zonas queda reservado al `Modificador de altura`.
- Nuevo módulo puro `plateau-tool.js` y pruebas de perfil, recorte y conversión de altura.

## 2.5.0

- Nuevo perfil avanzado de elevación para separar meseta, talud y base circular exterior.
- Radio de meseta, ancho de talud, ancho de base e intensidad de base configurables en bloques o porcentaje.
- Perfiles de descenso lineal, suave y escalonado Minecraft con 2–32 niveles.
- Recorte estricto opcional al radio exterior del pincel.
- Tres guías visibles bajo el cursor: meseta, final del talud y borde total.
- Los presets de pincel guardan y restauran todos los nuevos controles.
- Módulo puro `brush-profile.js` con pruebas numéricas del perfil.

## 2.4.0

- Nueva vista **Minecraft** bloque a bloque, separada de la malla suavizada.
- Los chunks visuales se solicitan bajo demanda en sectores de 16×16.
- La vista voxel usa las mismas reglas de bloques que la exportación Sponge `.schem`.
- Modo órbita y modo primera persona con WASD, Espacio y Shift.
- Distancia de render configurable entre 1 y 8 chunks.
- Bordes de bloque activables, agua transparente y corte vertical Y.
- Carga y descarte dinámico de chunks para mapas de hasta 2048×2048.

## 2.3.0

- Control directo del radio del núcleo del pincel y representación visual separada del falloff.
- Resumen numérico de radio total, núcleo, transición y dureza equivalente.
- Presets con nombre para pincel, compilación y borde montañoso, persistidos en el navegador.
- Dimensiones editables desde 32×32 hasta 2048×2048, siempre alineadas a 16 bloques.
- Presets rápidos hasta 2048×2048 y variantes rectangulares de gran formato.
- Pincel ampliado hasta 1024 bloques y parámetros montañosos escalados para mapas grandes.
- Caché del contorno jugable para evitar recalcular millones de celdas en cada movimiento del cursor.
- Exportación Sponge v3 por capas, evitando reservar todo el volumen de vóxeles en memoria.
- Límite de exportación ampliado a 750 millones de bloques, con advertencia desde 250 millones.

## 2.2.2

- Botón de semilla aleatoria compatible con HTTP.
- Opción de acumulación para los pinceles de Altura base y Modificador de altura.
- Modo no acumulativo por defecto para crear mesetas homogéneas durante un solo clic mantenido.
- Vista 3D ampliable a casi toda la ventana y cierre mediante Escape.
- Tooltips y pruebas automáticas para las tres mejoras.

## 2.2.1

- Corrige la creación de marcadores cuando la interfaz se abre mediante una IP HTTP sin `crypto.randomUUID()`.
- Las salidas ahora se ajustan al contorno real de `Límite jugable`, no al borde físico del lienzo.
- Añade previsualización del marcador antes del clic, dibujo de mayor contraste y confirmación con coordenadas.
- La lista de marcadores muestra tipo y posición.
- Los errores de colocación ahora se muestran en la barra de estado en lugar de fallar silenciosamente.

## 2.2.0

- Generador no destructivo de cordillera desde la máscara `playable`.
- Perfil exterior, transición interior y elevación configurables.
- Irregularidad y rugosidad reproducibles mediante la semilla del proyecto.
- Resolución automática de marcadores de salida contra el contorno jugable.
- Corredores de salida ensanchados hacia el exterior y adaptados hacia el interior.
- Protección del borde frente al ajuste de caminos, excepto dentro de corredores válidos.
- Botón **Preparar margen automático** con soporte de deshacer/rehacer.
- Guía visual del contorno y anchura de salidas en el lienzo.
- Nuevos tooltips para todas las opciones del borde montañoso.
- Validación de margen, contacto con el lienzo, techo vertical y ausencia de salidas.
- Datos 3D ampliados con máscara de montaña y corredores.
- Proyecto de muestra actualizado con cuatro salidas y cordillera compilada.

## 2.1.0

- Tooltips enriquecidos para las nueve capas del editor.
- Explicación explícita del efecto actual y futuro de cada capa.
- Vista 3D WebGL generada desde el terreno compilado.
- Navegación orbital, zoom, desplazamiento, recentrado y exageración vertical.
- Superficie de agua semitransparente, marcadores y malla opcional.
- Muestreo adaptativo exclusivo de la previsualización para mapas grandes.
- Nuevo archivo compilado `*_terrain3d.json`.
- Pruebas de API, formato 3D y cobertura de ayuda de capas.

## 2.0.0

- Reconstrucción completa paint-first.
- Arquitectura editor → compilador → exportadores.
- Dimensiones X/Z independientes y rectangulares.
- Formato de proyecto v2 con nueve capas RLE.
- Historial por operaciones, guardado y carga.
- Tooltips enriquecidos en todos los valores configurables.
- Compilación de agua, caminos, reservas, materiales y validación.
- Exportación Sponge Schematic v3.
