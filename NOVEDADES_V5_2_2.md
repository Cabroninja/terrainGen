# v5.2.2 — Corrección de cascadas escalonadas

## Problema corregido
Las paredes de meseta suelen bajar mediante muchos escalones pequeños. Cada salto individual podía ser menor que el umbral configurado, aunque la caída total fuera muy grande. El sistema no reconocía esa secuencia como cascada y generaba una lámina triangular o escalonada de agua sobre toda la pared.

## Cambios
- Detecta descensos acumulados y pronunciados, aunque cada escalón baje solo un bloque.
- Fusiona escalones consecutivos y pequeñas terrazas en una sola cascada.
- Mantiene descensos suaves como río normal, sin convertirlos en cascada.
- Localiza la cortina de agua en el labio superior.
- Coloca la poza receptora en el extremo inferior real de la pendiente.
- Evita que la poza aparezca a mitad de la pared en descensos largos.

## Validación
77 pruebas automatizadas superadas.
