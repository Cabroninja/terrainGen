# Instalación de JKR Terrain Generator v3.3.0

## Parche sobre v3.2.0

Coloca `JKR-Terrain-Generator-v3.3.0-PARCHE.zip` en la raíz del proyecto y ejecuta:

```bash
unzip -o JKR-Terrain-Generator-v3.3.0-PARCHE.zip
rm JKR-Terrain-Generator-v3.3.0-PARCHE.zip
docker compose down
docker compose up -d --build
docker compose logs --tail=100
```

Después realiza una recarga forzada del navegador (`Ctrl+F5`).

El parche añade `python-multipart`, por lo que es necesario reconstruir la imagen y no solamente reiniciar el contenedor. Los proyectos anteriores siguen abriendo normalmente con colecciones e instancias vacías.

## Proyecto completo

Extrae `JKR-Terrain-Generator-v3.3.0-COMPLETO.zip` en una carpeta nueva y ejecuta:

```bash
cd JKR-Terrain-Generator-v3.3.0
docker compose up -d --build
```

## Crear un bosque o campo rocoso

1. Selecciona la capa **Estructuras**.
2. Escribe un nombre, escoge **Árboles** o **Rocas** y pulsa **Crear**.
3. Pulsa **Importar .schem** y selecciona una o varias variantes.
4. Ajusta sus pesos y corrige el punto de apoyo solamente cuando una variante quede desplazada.
5. Elige **Poblar**.
6. Configura diámetro, cantidad y separación. Para máxima densidad usa separación `0` y cantidad alta.
7. Activa rotación o reflejo aleatorios y define el hundimiento.
8. Mantén clic y arrastra sobre el mapa.
9. Compila y revisa el resultado en **Vista Minecraft**.

Los archivos `.schem` se guardan embebidos dentro de `.jkrterrain.json`; una biblioteca grande aumenta el tamaño del proyecto editable.
