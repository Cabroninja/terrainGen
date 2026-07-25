# JKR Terrain Generator v5.3.0 — Río automático

## Cambio principal
El usuario vuelve a dibujar únicamente el recorrido horizontal del río. El compilador analiza el relieve completo y diseña automáticamente el perfil vertical.

El sistema decide:

- el sentido del flujo;
- dónde excavar;
- dónde agregar fondo y orillas;
- qué descensos pueden resolverse suavemente;
- qué diferencias deben convertirse en cascadas;
- dónde crear pozas receptoras;
- cómo contener las cascadas para Minecraft.

## Interfaz simplificada
Se retiraron de la interfaz los controles experimentales acumulados:

- Seguir terreno / Flujo descendente;
- soporte manual de descensos;
- umbral manual de cascada;
- pendiente máxima 1:X.

Ahora existe un único selector:

- **Tranquilo:** recorridos más suaves, pozas amplias y menos cascadas.
- **Natural:** equilibrio recomendado para mapas tipo Albion.
- **Montañoso:** más cascadas y cambios verticales compactos.

## Compatibilidad
Los proyectos de las versiones anteriores continúan abriendo. Los campos antiguos de los ríos se aceptan, pero el nuevo generador automático los reemplaza al compilar. Los ríos antiguos reciben el estilo **Natural** si todavía no tienen un estilo asignado.
