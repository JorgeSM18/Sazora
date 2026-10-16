# Sazora

Aplicación personal de alimentación que trabaja sobre la pauta de tu nutricionista. Sube sus PDF (la lista de alimentos y tu pauta), Sazora los lee con IA y, a partir de ahí, puedes planificar las comidas del día, registrar lo que comes y ver cuántas porciones te quedan.

Cada usuario tiene su propia lista, su propia pauta y su propio registro, guardados en el servidor y ligados a su cuenta.

## Funcionalidades

- **Importación desde PDF con Gemini.** Un único importador que clasifica el documento (lista de alimentos, pauta o ambas), extrae los datos y los muestra para revisarlos antes de guardar.
- **Mi dieta.** Porciones por comida, indicaciones de la nutricionista, tabla de equivalencias ("qué es 1 porción") y dudas de la importación, con enlace a la página del PDF original.
- **Plan diario.** Añadir alimentos o platos a cada comida, cambiar cantidades, reordenar, copiar comidas y días, y navegar entre fechas.
- **Registro de lo comido**, separado de lo previsto: marcar como comido, ajustar la cantidad real y registrar lo no previsto.
- **Totales.** Porciones comidas, previstas y restantes frente a la pauta. Energía y macros cuando los alimentos tienen datos; nunca se inventan ni se completan con ceros.
- **Recetas.** Los platos de ejemplo de la pauta, recetas propias, favoritas, raciones y cálculo por ración.
- **Alimentos.** Catálogo con equivalencias y datos nutricionales opcionales, editables desde la etiqueta del producto.
- **Cuentas.** Acceso con usuario y contraseña; alta desde la terminal del servidor o, si se activa, desde la app con un código de invitación.
- **Instalable en el móvil** (Android e iPhone) desde el navegador, con su icono y a pantalla completa.

## Requisitos

- Node.js **22.12 o superior** (usa `node:sqlite`, incluido en Node).
- Una clave de la API de Gemini para importar PDF ([Google AI Studio](https://aistudio.google.com/apikey)).

## Puesta en marcha (desarrollo)

```bash
npm install
cp .env.example .env              # rellena GEMINI_API_KEY
npm run usuario -- crear ana "Ana"  # pide la contraseña sin mostrarla
npm run server                    # API en http://localhost:8787
npm run dev                       # web en http://localhost:5173 (en otra terminal)
```

Vite redirige `/api` al servidor, así que en desarrollo se usa siempre `http://localhost:5173`. Para probar desde el móvil en la misma red: `npm run dev -- --host`.

| Script | Qué hace |
|---|---|
| `npm run dev` | Web en modo desarrollo |
| `npm run server` | Servidor: API, base de datos e importación (y la web compilada, si existe `dist/`) |
| `npm start` | Compila y arranca el servidor de producción (web y API en el mismo puerto) |
| `npm run usuario -- crear <usuario> "<Nombre>"` | Crea un usuario. También `clave <usuario>`, `listar` y `borrar <usuario>` |
| `npm run copia` | Copia de seguridad de la base de datos en `SAZORA_DATA_DIR/copias/` (conserva las últimas 14) |
| `npm test` | Pruebas unitarias, de servidor y de extremo a extremo |
| `npm run typecheck` · `npm run lint` · `npm run build` | Comprobaciones y compilación |

### Variables de entorno (`.env`)

| Variable | Por defecto | Para qué |
|---|---|---|
| `GEMINI_API_KEY` | — | Clave de Gemini. Solo la usa el servidor; los usuarios nunca la ven |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Modelo principal |
| `GEMINI_FALLBACK_MODELS` | `gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash` | Modelos de reserva si el principal está saturado |
| `PORT` | `8787` | Puerto del servidor |
| `HOST` | `127.0.0.1` | Dirección de escucha. Solo local por defecto (detrás del proxy HTTPS); `0.0.0.0` para abrirlo a la red |
| `SAZORA_CODIGO_REGISTRO` | — | Código de invitación para crear cuentas desde la app. Sin él, el registro está desactivado |
| `SAZORA_DATA_DIR` | `./server-data` | Base de datos y PDF de los usuarios |
| `COOKIE_SECURE` | — | Pon `1` cuando se sirva por HTTPS |

## Arquitectura

| Carpeta | Contenido |
|---|---|
| `src/domain/` | Modelo y reglas, sin React ni red. Motor de cálculo (`nutrition.ts`), plan e ingesta, resumen diario, validación e importación (`importFoodList.ts`, `importPlan.ts`) |
| `src/data/` | `repository.ts` (datos del usuario en el servidor), `maintenance.ts` y `fixtures/` (datos de prueba) |
| `src/state/` | Estado global: carga los datos, aplica las funciones del dominio y guarda cada cambio |
| `src/ui/` | Sesión, pantallas y componentes. Ninguna fórmula en la interfaz |
| `server/` | `index.mjs` (arranque), `app.mjs` (rutas), `db.mjs` (SQLite), `gemini.mjs` (lectura de PDF), `usuarios.mjs` (gestión de usuarios), `copia.mjs` (copias de seguridad) |
| `deploy/` | Servicio de systemd, copia diaria y configuración de Caddy (ver [DESPLIEGUE.md](DESPLIEGUE.md)) |
| `brand/` | Identidad visual: tokens de diseño (la app importa `tokens.css`) y logotipo |

**Decisiones principales**

- **Porciones como medida principal.** Las pautas de intercambios fijan porciones por grupo de alimentos, no calorías. El motor calcula porciones y, si hay datos, energía y macros.
- **Desconocido no es cero.** Un nutriente sin dato es `null` y los totales que lo incluyen se muestran como mínimo ("≥") o "—".
- **Unidades honestas.** Solo se convierte en la misma unidad o mediante una equivalencia documentada. Nunca g↔ml ni crudo↔cocinado.
- **Trazabilidad.** Cada equivalencia guarda su documento y su página. La pauta declara qué documentos usa (`exchangeDocs`), y una lista nueva sustituye a la anterior sin borrar el historial.
- **Plan ≠ ingesta.** Planificar no suma a lo comido, y registrar dos veces la misma comida no la duplica.
- **Datos por usuario.** Cada usuario guarda un documento JSON versionado en SQLite. Si dos dispositivos guardan a la vez, el segundo recibe un conflicto en vez de pisar al primero.
- **Sin dependencias en el servidor.** Solo Node: `node:http`, `node:sqlite` y `node:crypto`.

## Importar documentos (IA)

1. El PDF se sube al servidor, que lo guarda en la carpeta del usuario.
2. **Primera lectura:** Gemini clasifica el documento y, si contiene la lista de alimentos, la transcribe tabla a tabla.
3. **Segunda lectura**, si hay pauta: Gemini la transcribe con el catálogo de alimentos conocidos (incluida la lista del mismo PDF), para enlazar los ingredientes de los platos.
4. La app sanea la respuesta, comprueba que las comidas sumen los totales del día y la muestra para revisarla. Las porciones se pueden corregir antes de guardar.
5. Lo dudoso o lo que no pasa las comprobaciones queda en *Mi dieta → Dudas de la importación*, con enlace a la página del PDF.

El orden importa: primero la lista de alimentos y después la pauta. Un PDF que traiga las dos cosas se procesa de una vez. Si Gemini está saturado, el servidor reintenta y pasa a los modelos de reserva.

**Privacidad:** con la API gratuita de Gemini, Google puede usar el contenido enviado para mejorar sus productos y puede revisarlo una persona. Con la facturación activada en el proyecto, no. Para pautas con datos de salud, activa la facturación.

## Seguridad

- **Acceso:** sin registro público. Los usuarios se crean desde el servidor o, si se activa, desde la app con un código de invitación (comparación en tiempo constante y bloqueo tras 5 intentos fallidos). Contraseñas con scrypt y sal; sesiones con token aleatorio, guardado solo como hash, de 30 días.
- **Cookie de sesión:** `HttpOnly` y `SameSite=Strict`, más `Secure` con `COOKIE_SECURE=1`. Las peticiones que modifican datos exigen JSON.
- **Login:** máximo 5 intentos fallidos por usuario e IP cada 10 minutos. Mensaje genérico y tiempo constante, para no revelar qué usuarios existen.
- **Aislamiento:** cada usuario solo lee y escribe sus datos y sus PDF. Las rutas de archivos se validan para no salir de su carpeta.
- **Límites:** tamaño máximo de las peticiones y una importación a la vez por usuario.
- **Cabeceras:** CSP estricta en la página, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer` y `Cache-Control: no-store` en la API.
- **Secretos:** la clave de Gemini solo vive en el servidor (`.env`, fuera del repositorio).
- **Repositorio:** `docs/`, `server-data/` y `.env` están en `.gitignore`. Los datos de prueba del código están anonimizados.

- **Red:** el servidor escucha solo en `127.0.0.1` por defecto; el acceso es a través del proxy HTTPS de la red privada.

**Al desplegar:** sigue [DESPLIEGUE.md](DESPLIEGUE.md): HTTPS en la red privada con `COOKIE_SECURE=1`, servicio aislado con systemd, copia diaria y copias fuera de la VM.

## Pruebas

`npm test` ejecuta:

- **Dominio:** escalado nutricional, recetas y raciones, totales, plan frente a ingesta, nutrientes desconocidos, unidades incompatibles, objetivos no configurados, importación de lista y pauta, y dudas.
- **Datos de prueba:** las comidas suman los totales del día y 5 platos de ejemplo cuadran exactamente con las porciones de su comida.
- **Servidor:** sesiones, registro con código de invitación, límite de intentos, aislamiento entre usuarios, conflictos de versión, importación, cabeceras y rutas.
- **De extremo a extremo** (jsdom): primer arranque con lista → pauta, PDF combinado, planificar y registrar, reabrir conservando los datos, 404 y formularios inválidos.

Los datos de prueba (`src/data/fixtures/`) son una transcripción manual de una pauta real, anonimizada. Solo se usan en las pruebas: un usuario nuevo empieza sin datos.

## Limitaciones conocidas

- La equivalencia de cada alimento en la tabla de intercambios no se edita desde la interfaz; sí se pueden completar los datos nutricionales y marcar las dudas como revisadas.
- La compatibilidad de una receta propia con la pauta no se comprueba automáticamente: se muestran sus porciones junto a las de la comida.
- Las sustituciones documentadas (fruta ↔ carbohidrato, proteína semimagra = magra + grasa) se muestran como indicaciones, pero no se aplican al comparar con la pauta.
- No hay lista de la compra ni asistente conversacional todavía.
- `node:sqlite` aún está marcado como experimental en Node 22. Está aislado en `server/db.mjs`.

## Siguientes pasos

- Desplegar en la VM privada siguiendo [DESPLIEGUE.md](DESPLIEGUE.md).
- Asistente con IA que use el dominio como herramientas (`daySummary`, `recipePerServing`, las equivalencias de la pauta), sin poder modificar la pauta y validando sus propuestas con el motor antes de mostrarlas.
