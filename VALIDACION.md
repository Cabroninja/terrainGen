# Validación de la entrega v3.3.0

## Comandos ejecutados

```bash
python -m compileall -q app scripts tests
node --check app/static/app.js
node --check app/static/structure-tool.js
node --check app/static/voxel-viewer.js
python -m json.tool app/static/config-help.json
pytest -q
```

## Resultado

- 65 pruebas automáticas aprobadas.
- API de salud actualizada a v3.3.0.
- Importación API de un Sponge `.schem` comprobada con conservación exacta del archivo embebido.
- Lectura de dimensiones, paleta, BlockData y punto de apoyo automático comprobada.
- Colocación real de troncos y hojas comprobada en la matriz compartida de exportación.
- Rotación, reflejo, hundimiento y recorte vertical/horizontal ejecutados en el compilador.
- Paleta dinámica compartida por Vista Minecraft y `.schem`.
- Fuente voxel dispersa comprobada con estructuras dentro del chunk correspondiente.
- Proyectos anteriores sin biblioteca ni instancias compatibles mediante listas vacías.
- Referencias de colecciones, assets y colocaciones validadas al abrir y compilar.
- Sintaxis JavaScript, compilación Python y JSON de tooltips validados.

## Prueba integral

Se construyó un árbol de prueba en Sponge Schematic v3, se importó, se embebió en un proyecto, se colocó con rotación y hundimiento, se compiló y se leyó nuevamente desde la fuente voxel. Los mismos once bloques aparecieron en la capa de exportación y en la respuesta del chunk.

## Regla de aislamiento

Las estructuras no cambian heightmap, agua, caminos ni máscaras. Se aplican como bloques decorativos después de resolver el terreno final. El pincel de borrado elimina instancias, no excava ni restaura bloques del relieve.
