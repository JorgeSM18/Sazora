# Sazora — marca

Logo **A · Pizca** + dirección **Pimentón y cerámica**. Referencia visual: `propuesta.html`.

## Logo (`logo/`)

| Archivo | Uso |
|---|---|
| `sazora-horizontal-{color,mono,inverso}.svg` | Logotipo principal: la pizca es la primera letra de la palabra |
| `sazora-simbolo{,-mono,-inverso}.svg` | Símbolo solo: espacios cuadrados, avatar, splash, o cuando la marca ya está presente |
| `app-icon.svg` | Icono de app a sangre (iOS/Android/PWA maskable aplican su propia máscara; símbolo dentro de la zona segura del 80 %) |
| `favicon.svg` | `<link rel="icon" href="/favicon.svg" type="image/svg+xml">` |

**Construcción.** Símbolo en retícula de 48: dos círculos r8 apilados (centros 24,16 y 24,32), arcos de 230°, trazo 7, terminales redondos; punto r3.5 en 35.5,5.5. Wordmark construido (sin fuente): altura x 32, trazo 6. En el logotipo la S del símbolo sustituye a la primera letra: mismos arcos de 230°, redibujada a altura x (r6.5, trazo 6) y con el punto r3.2 en la misma dirección que en el símbolo, separado del terminal por ~1.3 u. La s y su punto van en pimentón; «azora» en tinta. Nunca se combinan símbolo y logotipo uno junto al otro.

**Tamaño mínimo.** Símbolo 16 px (6 mm impreso) · logotipo 80 px de ancho (20 mm).

**Espacio de protección.** Alrededor del logo, como mínimo el diámetro de un bucle de la S (≈ ⅓ de la altura del símbolo). No se coloca nada dentro de ese margen.

**Color.** Color sobre papel/blanco; mono (tinta) cuando solo haya un color; inverso sobre tinta o sobre fotografía oscura. El símbolo en pimentón no se pone sobre fondos rojos ni naranjas.

**No hacer.** Deformar, rotar, cambiar proporciones símbolo/wordmark, añadir sombras, degradados o contornos, recomponer el wordmark con otra fuente, ni separar el punto de la S.

## Tokens (`tokens.css`)

Importa `tokens.css` y usa en los componentes **solo los roles** (`--color-*`, `--text-*`, `--space-*`), nunca la paleta base (`--sz-*`).
Regla de las dos voces: `--color-pauta` solo para datos de la dieta original del nutricionista; `--color-accent` para acciones y sugerencias de cocina.
