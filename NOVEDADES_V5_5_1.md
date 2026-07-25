# JKR Terrain Generator v5.5.1 — Separadores fluidos

## Corrección aplicada
Se corrigió el comportamiento de los separadores deslizantes del panel **Validación y resultados**, tanto cuando está acoplado abajo como cuando está a la derecha.

### Problema anterior
Durante el movimiento del separador se disparaba un evento global de redimensionado. Ese evento volvía a leer el tamaño anterior guardado en el navegador antes de que terminara el arrastre, haciendo que el panel retrocediera, saltara o pareciera bloquearse.

### Cambios
- El tamaño se actualiza de forma continua durante el arrastre sin restaurar el valor antiguo.
- El redimensionado global de los visores se notifica al finalizar el movimiento.
- El arrastre continúa aunque el cursor salga físicamente del separador.
- El estado se limpia de forma segura al soltar, cancelar, perder la captura o cambiar de ventana.
- Se evita intentar liberar una captura de puntero que el navegador ya liberó.
- El refresco de separadores se agrupa en un solo frame para evitar llamadas repetidas.
- El panel derecho puede ocupar más espacio y conservar un editor mínimo adaptable.
- El panel inferior admite un rango de alturas más amplio.
- El divisor interno entre Validación y Resultados tiene mínimos menos restrictivos.
- Se mantienen el guardado independiente de tamaños y el doble clic para restablecer.

## Archivos incluidos
- `app/static/ui-shell.js`
- `app/static/styles.css`
- `tests/test_static_help.py`

## Instalación
Desde la raíz del proyecto:

```bash
unzip -o JKR-Terrain-Generator-v5.5.1-SEPARADORES-FLUIDOS-PARCHE.zip
docker compose up -d --build
```

Después recarga con `Ctrl + F5`.
