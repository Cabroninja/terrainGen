# v5.2.3 — Fondo y costados de soporte para ríos

## Problema corregido
En descensos desde mesetas, el río solo excavaba. Cuando el terreno inferior quedaba muy bajo, el agua ocupaba todo el espacio vacío y se veía como una gran lámina o triángulo.

## Nuevo comportamiento
Con **Seguir terreno** y **Crear soporte de terreno en descensos** activados:

- se calcula un fondo descendente similar al perfil de una rampa;
- se excava el terreno alto;
- se agregan bloques donde el terreno inferior no alcanza;
- la profundidad del agua permanece acotada;
- se crean costados secos locales con pendiente aproximada 1:2;
- se mantiene una poza compacta al finalizar el descenso;
- no se levantan bordes a lo largo de todo el río, solo en los descensos detectados.

No es suficiente abrir un proyecto ya compilado: debes volver a pulsar **Compilar** o **Exportar .schem** para regenerar el terreno.
