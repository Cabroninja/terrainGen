# v5.2.5 — Pendiente controlable en Flujo descendente

## Nuevo control
En Agua → Río libre → Flujo descendente → soporte de terreno se agregó:

**Pendiente máxima 1:X**

- 1:2: descenso corto y empinado.
- 1:4: equilibrado y valor predeterminado.
- 1:6: descenso largo y suave.
- 1:8 o superior: necesita mucho recorrido disponible.

## Funcionamiento
La aplicación calcula la longitud necesaria según la diferencia de altura. El descenso se extiende hacia atrás sobre la meseta y hacia delante sobre el terreno bajo. Después:

- excava donde sobra terreno;
- rellena donde falta soporte;
- mantiene el fondo a profundidad controlada;
- construye los costados de contención;
- coloca la poza al final del descenso extendido.

El perfil es lineal para que el centro no sea más empinado que la relación configurada.

## Recorrido insuficiente
Cuando el río no tiene longitud suficiente para cumplir la pendiente elegida, usa toda la distancia disponible y agrega una advertencia en Validación indicando:

- longitud requerida;
- longitud disponible;
- relación aproximada que realmente pudo utilizar.

Los proyectos antiguos reciben el valor predeterminado 1:4.
