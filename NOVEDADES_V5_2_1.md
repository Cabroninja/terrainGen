# JKR Terrain Generator v5.2.1

## Corrección del pie de las cascadas

Se corrigió la cuña o triángulo de agua que podía aparecer en la zona inferior de una cascada del modo **Seguir terreno**.

### Nuevo comportamiento

- La caída vertical queda concentrada en una cortina estrecha.
- El resto de la pendiente ya no se rellena hasta la cota superior del agua.
- Se genera una zona receptora a la altura inferior.
- La poza inferior queda conectada con un canal bajo y estable.
- La contención lateral continúa aplicándose únicamente alrededor de la cascada y la poza.
- Los ríos sin cascadas no cambian.

### Causa corregida

Antes, todo el tramo descendente detectado podía marcarse como agua de caída con la superficie superior. En pendientes largas esto generaba un volumen triangular de agua. Ahora solo la cortina utiliza la cota superior; la recepción y la continuación utilizan la cota inferior.

### Validación

- 75 pruebas automatizadas superadas.
- Se agregó una prueba específica para pendientes largas que verifica que la cortina permanezca localizada y no vuelva a formarse la cuña triangular.
