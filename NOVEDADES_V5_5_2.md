# JKR Terrain Generator v5.5.2 — Unión automática de pasadas de meseta

## Problema corregido
Cada vez que se soltaba el clic, el editor creaba una meseta editable diferente. Al rellenar una misma meseta mediante varias pasadas, el selector detectaba varios objetos superpuestos.

## Nuevo comportamiento
- Una pasada nueva se une automáticamente a una meseta existente cuando ambas conservan exactamente los mismos parámetros actuales.
- La unión solo ocurre cuando las superficies planas se tocan o superponen.
- Dos mesetas separadas, aunque tengan la misma altura, continúan siendo objetos independientes.
- Si una nueva pasada conecta dos fragmentos compatibles, pasan a formar una sola meseta.
- No se añadieron botones, modos ni parámetros.

## Parámetros comprobados
- Altura.
- Radio.
- Anchura de pendiente.
- Soporte exterior activado o desactivado.
- Anchura del soporte.
- Altura del soporte.

## Protección contra conexiones falsas
Las distintas pasadas se conservan internamente como trazos separados dentro del mismo objeto. El regenerador no dibuja una línea automática entre el final de una pasada y el inicio de la siguiente.

## Historial
Deshacer restaura el estado anterior a la última pasada y Rehacer vuelve a aplicar la unión.
