// "Lista de alimentos" de la nutricionista. PDF de prueba de 7 páginas (no incluido en el repositorio).
// Tabla de intercambios: cuánto de cada alimento es 1 porción de su grupo.
// No contiene calorías ni macronutrientes: aquí no se añade ninguno.
// Cabecera de todas las tablas: "GRAMOS (PESO EN CRUDO)". El estado se normaliza a "crudo" para
// alimentos que se cocinan y a "listo" para los que se consumen tal cual (normalización propia, ver informe).

import type { Food, SourceDocument } from '../../domain/types';
import { exchangeFoods, type ExchangeRow } from './util';

export const LISTA: SourceDocument = {
  id: 'lista-alimentos',
  title: 'Lista de alimentos',
  author: 'Nutricionista',
  kind: 'lista-intercambios',
};
const D = LISTA.id;

const carbohidratos: ExchangeRow[] = [
  { name: 'Papa/patata', amount: 90, household: '1 unidad pequeña' },
  { name: 'Boniato/batata', amount: 75, household: '1 peq o 1/2 grande' },
  { name: 'Plátano macho', amount: 50, household: '1/4' },
  { name: 'Yuca', amount: 50, household: '', state: 'cocido', note: 'La tabla indica "50g (cocido)".' },
  { name: 'Quinoa', amount: 20, household: '1/2 taza cocido' },
  { name: 'Pasta', amount: 20, household: '1/2 taza cocido' },
  { name: 'Arroz', amount: 20, household: '1/2 taza cocido' },
  { name: 'Avena/harina de avena', amount: 20, household: '2 cdas y 1/2', state: 'listo' },
  { name: 'Harina de maíz (pan)', amount: 20, household: '2 cdas', state: 'listo' },
  { name: 'Cornflakes', amount: 20, household: '2 cdas', state: 'listo' },
  { name: 'Pan blanco o integral de barra', amount: 30, household: 'Rebanada de 2 dedos', state: 'listo' },
  { name: 'Pan tostado', amount: 20, state: 'listo' },
  { name: 'Pan de molde', amount: 30, household: '1 rebanada', units: 1, unitLabel: 'rebanada', state: 'listo' },
  { name: 'Pan thins', amount: null, household: '1 unidad', units: 1, state: 'listo' },
  { name: 'Obleas estilo kalan', amount: 30, household: '1/2 paquete', state: 'listo' },
  { name: 'Miel', amount: 20, household: '2 cdas', state: 'listo' },
  { name: 'Maíz dulce', amount: 140, household: '2 latas', state: 'escurrido', review: '"140g = 2 latas": no se indica el tamaño de lata ni si es peso escurrido.' },
  { name: 'Cous-cous', amount: 20, household: '1/3 taza cocido' },
  { name: 'Tortitas de arroz/maíz', amount: 25, household: '2 unidades', units: 2, state: 'listo' },
  { name: 'Tortilla para fajitas', amount: null, household: '1 unidad o 2 pequeñas', state: 'listo', unitLabel: 'tortilla', note: 'Sin gramos en la lista. El plan 1.5 (pág. 7) precisa "1 fajita mediana = 1 porción".' },
  { name: 'Azúcar blanco/moreno', amount: 15, household: '1 cda y 1/2', state: 'listo' },
  { name: 'Crema de arroz', amount: 20, household: '2 cdas', state: 'listo' },
  { name: 'Palomitas de maíz', amount: 20, household: '3 tazas / 1/4 taza maíz', review: 'No queda claro si los 20 g son de maíz sin reventar o de palomitas.' },
  { name: 'Granola baja en grasa', amount: 20, household: '1/4 taza', state: 'listo' },
  { name: 'Casabe', amount: 20, state: 'listo' },
  { name: 'Pan árabe', amount: 30, household: '1/2 unid. pequ, 1/4 unid. gde.', state: 'listo' },
  { name: 'Pan Wasa', amount: null, household: '2 unidades', units: 2, unitLabel: 'cracker', state: 'listo' },
  { name: 'Galleta María', amount: 25, household: '3 unidades', units: 3, unitLabel: 'galleta', state: 'listo' },
];

const legumbres: ExchangeRow[] = [
  { name: 'Lentejas', amount: 30, household: '1/2 taza cocido' },
  { name: 'Garbanzos', amount: 30, household: '1/2 taza cocido' },
  { name: 'Frijoles/caraotas/alubias', amount: 30, household: '1/2 taza cocido' },
];

const proteinaMagra: ExchangeRow[] = [
  { name: 'Pescado blanco', amount: 40, household: '1 trozo pequeño' },
  { name: 'Camarones/gambas', amount: 40, household: '8 unidades medianas', units: 8 },
  { name: 'Atún al natural en lata', amount: null, household: '1/2 lata pequeña', state: 'escurrido', unitLabel: 'lata', review: 'Sin gramos; "1/2 lata pequeña". El plan 1.5 (pág. 7) dice "1 lata de atún = 2 porciones" sin indicar tamaño de lata.' },
  { name: 'Pechuga/solomillo de pollo o pavo', amount: 30, household: '1 trozo pequeño' },
  { name: 'Clara de huevo', amount: 60, household: '2 unidades o 1/4 taza', units: 2, unitLabel: 'clara' },
  { name: 'Jamón de pollo/pavo', amount: 30, household: '2-3 ruedas finas', state: 'listo' },
  { name: 'Lomo embuchado', amount: 20, state: 'listo' },
  { name: 'Calamares y mariscos', amount: 40 },
  { name: 'Carne roja magra (solomillo, lomo...)', amount: 30 },
  { name: 'Proteína en polvo (whey y vegana)', amount: null, household: '1 scoop = 3 raciones', state: 'listo', unitLabel: 'scoop', note: '"1 scoop = 3 raciones": se registra como 1 unidad (scoop) = 3 porciones.' },
  { name: 'Lomo de cerdo', amount: 30, household: '1 trozo pequeño' },
  { name: 'Soja', amount: 15, review: 'No se indica si es soja texturizada, en grano u otro formato.' },
  { name: 'Seitán', amount: 30, state: 'listo' },
  { name: 'Queso burgos light/desnatado', amount: 70, household: '1 vasito pequeño', state: 'listo' },
  { name: 'Yogur proteico/queso fresco batido 0%', amount: 70, state: 'listo' },
  { name: 'Queso mozzarella light', amount: 40, state: 'listo' },
  { name: 'Queso cottage', amount: 50, state: 'listo' },
  { name: 'Queso fresco light', amount: 60, state: 'listo', review: 'La lista dice 60 g; el plan 1.5 (pág. 9) dice 50 g. En el plan 1.5 prevalece el plan.' },
];

const proteinaSemimagra: ExchangeRow[] = [
  { name: 'Salmón, caballa', amount: 40 },
  { name: 'Huevo', amount: null, household: '1 unidad', units: 1, unitLabel: 'huevo' },
  { name: 'Carne de cerdo (graso)', amount: 30 },
  { name: 'Carne roja grasa', amount: 30 },
  { name: 'Jamón serrano/ibérico', amount: 30, household: '2 lonchas finas', state: 'listo' },
  { name: 'Sardinas', amount: 30, household: '1 unidad mediana' },
  { name: 'Atún en aceite', amount: 40, household: '1 lata pequeña', state: 'escurrido' },
  { name: 'Cordero', amount: 30 },
  { name: 'Tofu', amount: 65, state: 'listo' },
  { name: 'Queso burgos natural', amount: 70, state: 'listo' },
  { name: 'Queso mozzarella normal', amount: 40, state: 'listo' },
  { name: 'Queso parmesano', amount: 25, state: 'listo' },
];

const grasas: ExchangeRow[] = [
  { name: 'Aguacate', amount: 30, household: '1/4 (pequeño)', state: 'listo' },
  { name: 'Aceite de oliva', amount: 5, household: '1 cdta', state: 'listo' },
  { name: 'Pistachos', amount: 10, household: '18 unidades', units: 18, state: 'listo' },
  { name: 'Mantequilla', amount: 5, household: '1 cdta', state: 'listo' },
  { name: 'Avellanas', amount: 8, household: '8 unidades', units: 8, state: 'listo' },
  { name: 'Mantequilla de maní', amount: 10, household: '1 cda', state: 'listo', note: 'En el PDF: "Mantequila de maní".' },
  { name: 'Crema de frutos secos', amount: 10, household: '1 cda', state: 'listo' },
  { name: 'Coco rallado', amount: 8, household: '1 cda', state: 'listo' },
  { name: 'Aceituna verde (deshuesadas)', amount: 30, household: '10 unidades', units: 10, state: 'listo' },
  { name: 'Aceitunas negras', amount: 40, household: '15 unidades', units: 15, state: 'listo' },
  { name: 'Almendras', amount: 10, household: '8 unidades', units: 8, state: 'listo' },
  { name: 'Cashews/anacardos', amount: 10, household: '8 unidades', units: 8, state: 'listo' },
  { name: 'Nueces', amount: 10, household: '2 unidades grandes', state: 'listo' },
  { name: 'Aceite de coco', amount: 5, household: '1 cdta', state: 'listo' },
  { name: 'Chocolate negro (70-75%)', amount: 10, household: '1 cuadrado', state: 'listo' },
  { name: 'Nata para cocinar 15% y leche de coco', amount: 25, household: '1/4 vasito pequeño', state: 'listo' },
  { name: 'Cacahuetes/maní', amount: 10, household: '10 unidades', units: 10, state: 'listo' },
  { name: 'Mayonesa', amount: 7, household: '1 cdta', state: 'listo' },
  { name: 'Queso crema normal', amount: 20, household: '1 cda', state: 'listo' },
  { name: 'Semillas de girasol, ajonjolí, chía, linaza', amount: 20, household: '1 cda', state: 'listo' },
];

const lacteos: ExchangeRow[] = ([
  { name: 'Leche descremada/desnatada', amount: 200, household: '1 taza', state: 'listo', note: 'Lácteos descremados.' },
  { name: 'Yogur descremado (s/a)', amount: 200, household: '1 taza', state: 'listo', note: 'Lácteos descremados.' },
  { name: 'Leche semidesnatada', amount: 240, household: '1 taza', state: 'listo', note: 'Lácteos semidesnatados.' },
  { name: 'Yogur semidesnatado (s/a)', amount: 240, household: '2 unidades / 1 taza', units: 2, state: 'listo', note: 'Lácteos semidesnatados.' },
  { name: 'Leche entera', amount: 200, household: '1 taza', state: 'listo', note: 'Lácteos enteros.' },
  { name: 'Leche de cabra', amount: 200, household: '1 taza', state: 'listo', note: 'Lácteos enteros.' },
  { name: 'Leche de oveja', amount: 150, household: '½ vaso', state: 'listo', note: 'Lácteos enteros.' },
  { name: 'Cuajada', amount: 135, household: '1 unidad', units: 1, state: 'listo', note: 'Lácteos enteros.' },
  { name: 'Yogur natural entero', amount: 240, household: '1 taza', state: 'listo', note: 'Lácteos enteros.' },
  { name: 'Kéfir', amount: 200, household: '1 taza', state: 'listo', note: 'Lácteos enteros.' },
] as ExchangeRow[]).map((r) => ({ ...r, review: 'La tabla expresa leches y yogures en "gramos"; no se convierte a ml sin densidad.' }));

const frutas: ExchangeRow[] = [
  { name: 'Banana', amount: 80, household: '1/2 unidad', units: 0.5, note: 'En Venezuela, "cambur".' },
  { name: 'Piña', amount: 110, household: '1 rodaja' },
  { name: 'Melón', amount: 200, household: '1 taza' },
  { name: 'Sandía', amount: 200, household: '1 taza' },
  { name: 'Fresas', amount: 120, household: '1 taza' },
  { name: 'Frambuesas', amount: 120, household: '1/2 taza' },
  { name: 'Moras', amount: 150, household: '1 taza' },
  { name: 'Arándanos', amount: 100, household: '1/2 taza' },
  { name: 'Papaya', amount: 200, household: '1 taza' },
  { name: 'Mango', amount: 100, household: '1/2 taza' },
  { name: 'Manzana', amount: 130, household: '1 unidad', units: 1 },
  { name: 'Pera', amount: 120, household: '1 unidad', units: 1 },
  { name: 'Kiwi', amount: 100, household: '1 unidad', units: 1 },
  { name: 'Caqui', amount: 90, household: '1/2 unidad', units: 0.5 },
  { name: 'Durazno/melocotón', amount: 100, household: '2 unidades peq' },
  { name: 'Ciruela', amount: 100, household: '1 unidad grande' },
  { name: 'Uvas', amount: 90, household: '8 unidades', units: 8 },
  { name: 'Higos', amount: 80, household: '2 unidades', units: 2 },
  { name: 'Naranja', amount: 130, household: '1 unidad', units: 1 },
  { name: 'Mandarina', amount: 130, household: '2 unidades', units: 2 },
  { name: 'Cerezas', amount: 110, household: '1/2 taza' },
  { name: 'Chirimoya', amount: 80 },
  { name: 'Granada', amount: 80 },
  { name: 'Guanábana', amount: 90, household: '1/2 taza' },
  { name: 'Uvas pasas', amount: 20, household: '16 unidades', units: 16 },
  { name: 'Dátiles', amount: 20, household: '2 unidades', units: 2 },
].map((r) => ({ ...r, state: 'listo' as const }));

// Vegetales: sin gramos. "1 porción = 1/2 taza cocidos/sopa/jugo ó 1 taza crudos". Se cuentan en porciones.
// El PDF repite Pimiento (×3), Chayota, Vainitas y Espárragos (×2): se registran una vez.
// "Ají dulceHongos" aparece pegado en la tabla: se separa en dos.
const vegetales = [
  'Acelgas', 'Hinojo', 'Ají dulce', 'Hongos', 'Ajo', 'Jugo de tomate', 'Ajo porro', 'Lechuga', 'Alcachofa', 'Nabo',
  'Pimiento', 'Calabacín', 'Quimbombó', 'Cebolla', 'Rábanos', 'Cebollín', 'Remolacha', 'Celery o apio', 'Alfalfa',
  'Palmito', 'Calabaza', 'Pepino', 'Berenjena', 'Perejil', 'Berros', 'Brócoli', 'Chayota', 'Repollo', 'Coliflor',
  'Tomate', 'Corazón de alcachofa', 'Tomate en lata', 'Repollitos de Bruselas', 'Escarola', 'Vainitas', 'Espárragos',
  'Vegetales chinos', 'Espinaca', 'Zanahoria', 'Edamames',
];

export function listaFoods(): Food[] {
  const veg: Food[] = vegetales.map((name) => ({
    ...exchangeFoods(D, 7, 'Vegetales', 'vegetales', 'crudo', [{ name, amount: null }])[0]!,
    unitLabel: 'porción',
    equivalences: [{
      amount: 1, unit: 'porcion', portions: { vegetales: 1 }, householdMeasure: '1/2 taza cocidos/sopa/jugo ó 1 taza crudos',
      source: { doc: D, page: 7, section: 'Vegetales', raw: name }, status: 'verificado',
    }],
    notes:
      name === 'Edamames'
        ? 'En el PDF aparece como "Edamames (*)" sin explicar el asterisco.'
        : '1 porción = 1/2 taza cocidos/sopa/jugo ó 1 taza crudos.',
    status: name === 'Edamames' ? 'pendiente' : 'verificado',
  }));
  const foods = [
    ...exchangeFoods(D, 2, 'Carbohidratos', 'carbohidratos', 'crudo', carbohidratos),
    ...exchangeFoods(D, 3, 'Legumbres', 'carbohidratos', 'crudo', legumbres).map((f) => ({
      ...f,
      notes: 'La lista agrupa las legumbres aparte; se cuentan como carbohidratos porque comparten página y medida (pendiente de confirmar).',
      status: 'pendiente' as const,
    })),
    ...exchangeFoods(D, 4, 'Proteína magra', 'proteinaMagra', 'crudo', proteinaMagra),
    ...exchangeFoods(D, 4, 'Proteína semimagra', 'proteinaSemimagra', 'crudo', proteinaSemimagra),
    ...exchangeFoods(D, 5, 'Grasas', 'grasas', 'listo', grasas),
    ...exchangeFoods(D, 5, 'Lácteos', 'lacteos', 'listo', lacteos),
    ...exchangeFoods(D, 6, 'Frutas', 'frutas', 'listo', frutas),
    ...veg,
  ];
  // La proteína en polvo: "1 scoop = 3 raciones".
  const polvo = foods.find((f) => f.id === 'proteina-en-polvo-whey-y-vegana')!;
  polvo.equivalences.push({
    amount: 1,
    unit: 'unidad',
    portions: { proteinaMagra: 3 },
    householdMeasure: '1 scoop = 3 raciones',
    source: { doc: D, page: 4, section: 'Proteína magra', raw: 'Proteína en polvo (whey y vegana) | - | 1 scoop = 3 raciones' },
    status: 'verificado',
  });
  return foods;
}
