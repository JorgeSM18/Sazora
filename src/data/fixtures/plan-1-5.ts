// "Plan Nutricional 1.5". PDF de prueba de 16 páginas de otra persona (no incluido en el repositorio; datos anonimizados).
// Datos de prueba: pauta de otra persona. No se usa como valor por defecto de ningún otro perfil.
// El plan fija PORCIONES por comida y por día. No fija calorías ni macronutrientes: nutrientTargets queda vacío.

import type { Diet, DietRule, Food, PortionEquivalence, Recipe, ReviewItem, SourceDocument } from '../../domain/types';

export const PLAN_15: SourceDocument = {
  id: 'plan-1-5',
  title: 'Plan Nutricional 1.5',
  version: '1.5',
  kind: 'plan',
};
const D = PLAN_15.id;
export const PLAN_15_DIET_ID = 'diet-plan-1-5';
const src = (page: number, raw: string, section?: string) => ({ doc: D, page, raw, section });

const eq = (amount: number, unit: PortionEquivalence['unit'], portions: PortionEquivalence['portions'], page: number, raw: string, status: PortionEquivalence['status'] = 'verificado', note?: string): PortionEquivalence => ({
  amount, unit, portions, source: src(page, raw), status, note,
});

/** Equivalencias que el plan añade a alimentos que ya están en la lista. */
export const PLAN_15_EXTRA_EQUIVALENCES: Record<string, PortionEquivalence[]> = {
  'yogur-proteico-queso-fresco-batido-0': [eq(70, 'g', { proteinaMagra: 1 }, 5, 'El yogur ideal es yogur proteico o queso fresco batido [...] (70g es una porción).')],
  'tortilla-para-fajitas': [eq(1, 'unidad', { carbohidratos: 1 }, 7, '1 fajita mediana = 1 porción de carbohidratos. Preferible su presentación integral.', 'verificado', 'Fajita mediana.')],
  'atun-al-natural-en-lata': [eq(1, 'unidad', { proteinaMagra: 2 }, 7, '1 lata de atún = 2 porciones de proteína. Preferiblemente el que es natural sin aceite.', 'pendiente', 'No se indica el tamaño de la lata.')],
  'chocolate-negro-70-75': [eq(10, 'g', { grasas: 1 }, 7, '10g de chocolate negro = 1 porción de grasa. Ideal del 70%.')],
  'aceite-de-oliva': [eq(5, 'ml', { grasas: 1 }, 6, 'si para una preparación añades 5ml de aceite de oliva (aprox. 1 cucharadita) ya debes contarlo como tu porción de grasa.')],
  'proteina-en-polvo-whey-y-vegana': [eq(1, 'unidad', { proteinaMagra: 3 }, 8, '1 scoop de proteína en polvo = 3p de proteína magra.')],
  'queso-mozzarella-light': [eq(40, 'g', { proteinaMagra: 1 }, 9, 'Mozzarella light fresca | 40g | 1 porción de proteína magra')],
  'queso-fresco-light': [eq(50, 'g', { proteinaMagra: 1 }, 9, 'Queso fresco light | 50g | 1 porción de proteína magra', 'pendiente', 'La lista de alimentos dice 60 g.')],
  'queso-cottage': [eq(50, 'g', { proteinaMagra: 1 }, 9, 'Queso cottage | 50g | 1 porción de proteína magra')],
  'pan-wasa': [eq(2, 'unidad', { carbohidratos: 1 }, 13, 'Wasa Original: 2 crackers es 1 porción de cabrohidratos', 'pendiente', 'Marca leída de la imagen del producto.')],
};

const food = (id: string, name: string, extra: Partial<Food>): Food => ({
  id, name, state: 'listo', equivalences: [], origin: 'documento', status: 'verificado', ...extra,
});

/** Alimentos que solo aparecen en el plan. */
export function plan15Foods(): Food[] {
  return [
    food('arepa-masa', 'Arepa (masa)', {
      group: 'carbohidratos', state: 'cocido',
      equivalences: [eq(100, 'g', { carbohidratos: 2 }, 7, 'Arepa con 40g de harina pan = 100g de masa = 2 porciones de carbohidratos.')],
    }),
    food('gnocchis', 'Gnocchis', { group: 'carbohidratos', state: 'crudo', equivalences: [eq(40, 'g', { carbohidratos: 1 }, 7, '40g de gnocchis = 1 porción de carbohidrato.')] }),
    food('queso-latino', 'Queso latino', { group: 'grasas', equivalences: [eq(25, 'g', { grasas: 1 }, 8, 'El queso latino es 25g 1p de grasa.')] }),
    food('focaccia-mercadona', 'Focaccia', {
      brand: 'Mercadona', unitLabel: 'paquete',
      equivalences: [eq(1, 'unidad', { grasas: 3, carbohidratos: 4 }, 8, '1 foccaccia de Mercadona es un poco alta en porciones: el paquete entero tiene 3 porciones de grasa y 4 de carbohidratos.')],
    }),
    food('queso-havarti-light', 'Queso Havarti light', { group: 'proteinaMagra', unitLabel: 'loncha', equivalences: [eq(1, 'unidad', { proteinaMagra: 1 }, 9, 'Queso Havarti light | 1 loncha | 1 porción de proteína magra')] }),
    food('queso-feta', 'Queso feta', { group: 'grasas', equivalences: [eq(30, 'g', { grasas: 1 }, 9, 'Queso feta | 30g | 1 porción de grasa')] }),
    food('pan-cero-cero-bimbo', 'Pan Cero & Cero', {
      brand: 'Bimbo', group: 'carbohidratos', unitLabel: 'rebanada', status: 'pendiente', notes: 'Producto identificado por la imagen.',
      equivalences: [eq(2, 'unidad', { carbohidratos: 1 }, 13, '2 rebanadas equivalen a 1p de carbohidratos', 'pendiente')],
    }),
    food('pancito-sottile-integral', 'Pancito Sottile integral', {
      brand: 'Dulcesol', group: 'carbohidratos', unitLabel: 'pancito', status: 'pendiente', notes: 'Producto identificado por la imagen.',
      equivalences: [eq(1, 'unidad', { carbohidratos: 1 }, 13, '1 pancito dividible es 1p de carbohidratos.', 'pendiente')],
    }),
    food('tortitas-arroz-legumbres', 'Tortitas de arroz y legumbres', {
      brand: 'Hacendado', group: 'carbohidratos', unitLabel: 'paquete', status: 'pendiente', notes: 'Producto identificado por la imagen.',
      equivalences: [eq(1, 'unidad', { carbohidratos: 1 }, 13, 'Paquete completo es 1 porción de carbohidratos', 'pendiente')],
    }),
    food('crackers-fibra-sesamo', 'Pan fibra & sésamo (crackers)', {
      brand: 'Hacendado', group: 'carbohidratos', unitLabel: 'cracker', status: 'pendiente', notes: 'Producto identificado por la imagen.',
      equivalences: [eq(3, 'unidad', { carbohidratos: 1 }, 13, '3 crackers es 1 porción de cabrohidratos', 'pendiente')],
    }),
    food('yogur-proteico-bebible', 'Yogur proteico bebible', {
      unitLabel: 'unidad', status: 'pendiente',
      notes: 'El plan solo indica "20-21g de proteína". Porciones no documentadas.',
      nutrition: { per: 1, unit: 'unidad', values: { kcal: null, protein: 20, carbs: null, fat: null }, source: 'Plan 1.5, pág. 4: "1 yogur proteico bebible (20-21g de proteína)". Se usa el valor inferior.', status: 'pendiente' },
    }),
    food('queso-gouda-light', 'Queso gouda light', { group: 'proteinaMagra', unitLabel: 'loncha', status: 'pendiente', notes: 'Aparece en un desayuno de ejemplo; no tiene equivalencia en ningún documento.' }),
    food('carne-molida', 'Carne molida', { state: 'crudo', status: 'pendiente', notes: 'Aparece en un almuerzo de ejemplo; no se indica si es magra o grasa.' }),
    food('cafe-con-leche-de-avena', 'Café con leche de avena', { unitLabel: 'café', notes: 'El plan dice que sus 2 cafés con leche de avena están incluidos.' }),
    food('mermelada-sin-azucar', 'Mermelada sin azúcar', {}),
    food('tomate-triturado', 'Tomate triturado / passata', {}),
    food('aceite-en-spray', 'Aceite de oliva en spray', {}),
    food('caldo', 'Sopa, caldo o consomé (sin carbohidratos añadidos)', {}),
    food('vegetales-variados', 'Vegetales variados', { group: 'vegetales', state: 'otro', unitLabel: 'porción', notes: '1 porción = 1/2 taza cocidos/sopa/jugo ó 1 taza crudos.' }),
  ];
}

const rule = (id: string, kind: DietRule['kind'], page: number, text: string, status: DietRule['status'] = 'verificado', doc = D): DietRule => ({
  id, kind, text, source: { doc, page }, status,
});

const rules: DietRule[] = [
  rule('r-distribucion', 'consejo', 3, 'Con las porciones totales puedes distribuirlas a lo largo del día como prefieras, aunque lo ideal es seguir la distribución por comidas.'),
  rule('r-sm', 'equivalencia', 3, '1 porción de proteína semimagra = 1 porción de grasa + 1 porción de proteína magra. Se puede dividir así (pág. 6).'),
  rule('r-fruta-carbo', 'sustitucion', 7, 'Una porción de fruta se puede cambiar por una porción de carbohidratos/almidón y viceversa.'),
  rule('r-preentreno', 'consejo', 5, 'Pre-entreno siempre: 1 cambur extra a tus porciones + 1 de tus cafés con leche de avena.'),
  rule('r-cafes', 'libre', 5, 'Están incluidos tus 2 cafés con leche de avena. La porción de lácteos es 0; si quieres incluir leche de vaca puedes sin contabilizarla, preferiblemente desnatada.'),
  rule('r-merienda', 'consejo', 5, 'Puedes mover la merienda a la mañana o dividir el desayuno (p. ej. dejar 1p de fruta y 1p de grasa para media mañana).'),
  rule('r-recetas', 'consejo', 5, 'Puedes adaptar las recetas al momento del día que mejor te venga, siempre que cumplas las porciones totales del día.'),
  rule('r-spray', 'libre', 6, 'Cocinar con aceite de oliva en spray no se contabiliza. 5 ml de aceite (aprox. 1 cdta) sí cuentan como 1 porción de grasa.'),
  rule('r-pavo', 'consejo', 6, 'Comprar jamón de pavo con más de 92% de pollo/pavo en los ingredientes.'),
  rule('r-sin-grasa-extra', 'restriccion', 6, 'Con carne molida y salmón no añadir grasa extra al plato.'),
  rule('r-crudo', 'equivalencia', 6, 'Los pesos de las proteínas son en crudo. Para pesar en cocido, restar el 20% al peso indicado (ejemplo del plan: 120 g de pollo crudo = 100 g cocido).', 'pendiente'),
  rule('r-vegetales', 'libre', 6, 'Puedes incluir los vegetales que quieras, no hace falta pesarlos ni medirlos.'),
  rule('r-mermelada', 'libre', 6, 'La mermelada sin azúcar no se contabiliza.'),
  rule('r-quesos', 'consejo', 7, 'Los quesos y yogures recomendados contabilizan como proteína.'),
  rule('r-passata', 'libre', 8, 'Passata, tomate triturado, etc. se pueden usar sin contabilizar.'),
  rule('r-parmesano', 'equivalencia', 8, 'Un poco de parmesano no se contabiliza; si usas más de 20 g, cuenta como 1 porción de proteína semimagra.', 'pendiente'),
  rule('r-sopas', 'libre', 8, 'Sopas, caldos y consomé no se cuentan, salvo que añadas carbohidratos (pasta, papa, etc.).'),
  rule('r-veg-porcion', 'equivalencia', 7, '1 porción de vegetales = 1/2 taza de vegetales cocidos/sopa/jugo ó 1 taza de vegetales crudos.', 'verificado', 'lista-alimentos'),
  rule('r-aceite-coco', 'consejo', 15, 'Usar aceite de oliva/coco/aguacate en spray para cocinar.'),
  rule('r-horario', 'consejo', 15, 'Mantener un horario de comidas estable y no saltarse ninguna de las 4 comidas.'),
  rule('r-especias', 'libre', 15, 'Puedes utilizar todas las especias que quieras.'),
  rule('r-cafe', 'libre', 15, 'Café e infusiones permitidos; con leche, máximo 2 al día.'),
  rule('r-batch', 'consejo', 15, 'Dedicar 1-2 días a la semana a cocinar con antelación (vegetales salteados, arroz integral, pollo mechado).'),
  rule('r-agua', 'consejo', 16, 'Tomar mínimo 3 litros de agua al día.'),
  rule('r-endulzar', 'libre', 16, 'Para endulzar: stevia o edulcorantes como monkfruit, eritritol o sucralosa.'),
  rule('r-restaurante', 'consejo', 16, 'En restaurantes: plato principal saludable y compartir postre y entrantes.'),
  rule('r-pesar', 'consejo', 16, 'Pesar la comida al menos 2 semanas para "entrenar el ojo"; después no hace falta a diario.'),
  rule('r-relacion', 'consejo', 15, 'El objetivo es un cambio a largo plazo: un capricho puntual no rompe el plan; se vuelve al plan después.'),
];

const review = (id: string, page: number, text: string, doc = D): ReviewItem => ({ id, text, source: { doc, page }, resolved: false });

const reviewItems: ReviewItem[] = [
  review('rv-almidones', 3, 'La tabla por comidas (pág. 2) llama "carbohidratos" al grupo que la tabla de totales (pág. 3) llama "almidones". Se tratan como el mismo grupo.'),
  review('rv-queso-fresco', 9, 'Queso fresco light: 50 g = 1 porción en el plan; 60 g en la lista de alimentos. En esta dieta se usa el valor del plan.'),
  review('rv-crudo-cocido', 6, 'Regla "restar el 20%": el ejemplo dice 120 g crudo = 100 g cocido, pero 120 − 20% = 96 g. No se aplica ninguna conversión automática.'),
  review('rv-parmesano', 8, 'Parmesano: "si usas >20g" cuenta como 1 porción semimagra, mientras la lista dice 25 g = 1 porción. Umbral pendiente de aclarar.'),
  review('rv-atun', 7, '"1 lata de atún = 2 porciones" no indica el tamaño de la lata; la lista habla de "1/2 lata pequeña" para 1 porción.'),
  review('rv-bebible', 4, 'Yogur proteico bebible: el plan solo indica su proteína (20-21 g). No se sabe cuántas porciones cuenta; la merienda pide 1 fruta + 3 proteína magra.'),
  review('rv-gouda', 4, 'Queso gouda light (desayuno 3): no tiene equivalencia documentada.'),
  review('rv-molida', 4, 'Carne molida (almuerzo 2): no se indica si cuenta como proteína magra o semimagra.'),
  review('rv-pesto', 4, '8 g de pesto (cena 2): no figura en ninguna tabla.'),
  review('rv-bola', 4, '"1 bola de queso mozzarella fresco light" (cena 2): el peso de la bola no está documentado.'),
  review('rv-mozz-rallado', 4, 'Fajipizza: 60 g de mozzarella rallado se interpreta como mozzarella normal (semimagra); la nota del plan dice que por eso no se añade grasa.'),
  review('rv-productos', 10, 'Páginas 10-14: productos recomendados mostrados como imágenes. Solo se han registrado los que tienen una equivalencia escrita (pág. 13); los nombres se han leído de las fotos.'),
  review('rv-legumbres', 3, 'Legumbres: la lista de alimentos las presenta aparte; se cuentan como carbohidratos (mismo grupo de 30 g en crudo). Confirmar con la nutricionista.', 'lista-alimentos'),
  review('rv-lacteos', 5, 'Lácteos: la lista expresa leche y yogur en "gramos". No se convierten a ml.', 'lista-alimentos'),
];

export function plan15Diet(): Diet {
  return {
    id: PLAN_15_DIET_ID,
    name: 'Plan Nutricional 1.5',
    holder: 'Persona de prueba',
    documents: [D, 'lista-alimentos'],
    documentVersion: '1.5',
    importedAt: '2026-10-16',
    status: 'pendiente',
    notes: ['Meta: adaptar tus modificaciones.', 'Datos de prueba extraídos de los PDF de docs/. Revisar las dudas antes de usarlos como referencia.'],
    meals: [
      { id: 'desayuno', name: 'Desayuno', portionTargets: { frutas: 1, carbohidratos: 2, proteinaMagra: 2, proteinaSemimagra: 2, grasas: 1 } },
      { id: 'almuerzo', name: 'Almuerzo', portionTargets: { vegetales: 1, carbohidratos: 2, proteinaMagra: 4, grasas: 2 } },
      { id: 'merienda', name: 'Merienda', portionTargets: { frutas: 1, proteinaMagra: 3 } },
      { id: 'cena', name: 'Cena', portionTargets: { vegetales: 1, carbohidratos: 2, proteinaMagra: 4, grasas: 1 } },
    ],
    dailyPortionTargets: { lacteos: 0, vegetales: 2, frutas: 2, carbohidratos: 6, proteinaMagra: 13, proteinaSemimagra: 2, grasas: 4 },
    nutrientTargets: {},
    exchangeDocs: [D, 'lista-alimentos'],
    rules,
    freeFoodIds: ['cafe-con-leche-de-avena', 'mermelada-sin-azucar', 'tomate-triturado', 'aceite-en-spray', 'caldo'],
    review: reviewItems,
  };
}

// ── Platos del "Ejemplo de plan nutricional" (pág. 4) ──────────────────────

type Ing = Recipe['ingredients'][number];
const i = (foodId: string, label: string, quantity: number, unit: Ing['unit'], note?: string): Ing => ({ foodId, label, quantity, unit, note });
const libre = (label: string): Ing => ({ label, note: 'libre' });
const sinCalcular = (label: string, note: string): Ing => ({ label, note });

function dish(n: number, mealId: string, name: string, raw: string, ingredients: Ing[], description = ''): Recipe {
  return {
    id: `p15-${mealId}-${n}`,
    name,
    description: description || raw,
    ingredients,
    servings: 1,
    steps: [],
    category: mealId[0]!.toUpperCase() + mealId.slice(1),
    tags: ['plan 1.5'],
    origin: 'documento',
    mealHint: mealId,
    source: { doc: D, page: 4, section: 'Ejemplo de plan nutricional', raw },
    status: 'pendiente',
    favorite: false,
    createdAt: '2026-10-16',
  };
}

export function plan15Recipes(): Recipe[] {
  return [
    dish(1, 'desayuno', 'Arepa con huevo, pollo, havarti y aguacate',
      '1 arepa de 100g (40g de harina pan) con 2 huevos, 30g de pechuguita de pollo La Carloteña, 1 loncha de queso havarti light y 30g de aguacate. 110g de piña.', [
        i('harina-de-maiz-pan', 'Harina de maíz (pan)', 40, 'g', 'Arepa de 100 g'),
        i('huevo', 'Huevos', 2, 'unidad'),
        i('jamon-de-pollo-pavo', 'Pechuguita de pollo La Carloteña', 30, 'g', 'Contada como jamón de pollo/pavo (interpretación).'),
        i('queso-havarti-light', 'Queso havarti light', 1, 'unidad'),
        i('aguacate', 'Aguacate', 30, 'g'),
        i('pina', 'Piña', 110, 'g'),
      ]),
    dish(2, 'desayuno', 'Pancakes de avena con cottage',
      'Pancakes de 2 huevos + 40g de harina de avena + 70g de yogur + ½ cambur, stevia y canela al gusto. Topping: 1 cda. de mermelada sin azúcar y 50g de cottage. 10g de chocolate negro.', [
        i('huevo', 'Huevos', 2, 'unidad'),
        i('avena-harina-de-avena', 'Harina de avena', 40, 'g'),
        i('yogur-proteico-queso-fresco-batido-0', 'Yogur', 70, 'g', 'El plan dice "yogur"; se toma yogur proteico (nota pág. 5).'),
        i('banana', '½ cambur', 0.5, 'unidad'),
        libre('Stevia y canela al gusto'),
        i('mermelada-sin-azucar', 'Mermelada sin azúcar', 1, 'unidad', '1 cda'),
        i('queso-cottage', 'Queso cottage', 50, 'g'),
        i('chocolate-negro-70-75', 'Chocolate negro', 10, 'g'),
      ]),
    dish(3, 'desayuno', 'Sándwich de jamón serrano y gouda',
      'Sandwich con 2 rebanadas de pan integral 30g de jamón serrano, 2 lonchas de queso gouda light + tomate y rúcula. + 1 huevo cocido 100g de mango y 10g de chocolate negro.', [
        i('pan-de-molde', 'Pan integral', 2, 'unidad', 'Contado como pan de molde (1 rebanada = 1 porción).'),
        i('jamon-serrano-iberico', 'Jamón serrano', 30, 'g'),
        i('queso-gouda-light', 'Queso gouda light', 2, 'unidad', 'Sin equivalencia documentada.'),
        libre('Tomate y rúcula'),
        i('huevo', 'Huevo cocido', 1, 'unidad'),
        i('mango', 'Mango', 100, 'g'),
        i('chocolate-negro-70-75', 'Chocolate negro', 10, 'g'),
      ]),
    dish(1, 'almuerzo', 'Salmón al airfryer con arroz y ensalada',
      '160g de salmón en el airfryer y 1 taza de arroz (cocido o 40g crudo), ensalada rallada (repollo y zanahoria) con aderezo de yogur proteico, mostaza, sal y pimienta.', [
        i('salmon-caballa', 'Salmón', 160, 'g'),
        i('arroz', 'Arroz (40 g en crudo = 1 taza cocido)', 40, 'g'),
        i('vegetales-variados', 'Ensalada rallada (repollo y zanahoria)', 1, 'porcion', 'Porción de vegetales interpretada.'),
        sinCalcular('Aderezo de yogur proteico, mostaza, sal y pimienta', 'Cantidad de yogur no indicada.'),
      ]),
    dish(2, 'almuerzo', 'Bowl de carne molida y boniato',
      'Bowl de 90g de carne molida + 150g de boniato en cubitos + 50g de queso cottage + 60g de aguacate + tomate cherry + rúcula', [
        i('carne-molida', 'Carne molida', 90, 'g', 'Sin equivalencia: ¿magra o semimagra?'),
        i('boniato-batata', 'Boniato', 150, 'g'),
        i('queso-cottage', 'Queso cottage', 50, 'g'),
        i('aguacate', 'Aguacate', 60, 'g'),
        libre('Tomate cherry y rúcula'),
      ]),
    dish(3, 'almuerzo', 'Pechuga de pollo con plátano y vegetales',
      'Pechuga de pollo (120g) con 100g de plátano en el airfryer/horno, vegetales cocidos (calabacín, zanahoria, cebolla, berenjena). Postre: 20g de chocolate negro.', [
        i('pechuga-solomillo-de-pollo-o-pavo', 'Pechuga de pollo', 120, 'g'),
        i('platano-macho', 'Plátano', 100, 'g', 'Contado como plátano macho (interpretación).'),
        i('vegetales-variados', 'Vegetales cocidos (calabacín, zanahoria, cebolla, berenjena)', 1, 'porcion'),
        i('chocolate-negro-70-75', 'Chocolate negro (postre)', 20, 'g'),
      ]),
    dish(1, 'merienda', 'Yogur proteico bebible', '1 yogur proteico bebible (20-21g de proteína)', [
      i('yogur-proteico-bebible', 'Yogur proteico bebible', 1, 'unidad'),
    ]),
    dish(2, 'merienda', 'Batido de proteína y kiwi', 'Batido de proteína (1 scoop) + 1 kiwi', [
      i('proteina-en-polvo-whey-y-vegana', 'Proteína en polvo', 1, 'unidad', '1 scoop'),
      i('kiwi', 'Kiwi', 1, 'unidad'),
    ]),
    dish(1, 'cena', 'Fajipizza',
      'Fajipizza: 2 fajitas medianas integrales con tomate triturado + 60g de queso mozzarella rallado*. Topping: champiñones, 30g de jamón de pavo, 40g de queso mozzarella fresco light. y tomate cherry. *no añadí grasa porque el mozzarella rallado es un queso un poco más alto en grasa.', [
        i('tortilla-para-fajitas', 'Fajitas medianas integrales', 2, 'unidad'),
        i('tomate-triturado', 'Tomate triturado', 1, 'unidad'),
        i('queso-mozzarella-normal', 'Queso mozzarella rallado', 60, 'g', 'Contado como mozzarella normal (interpretación).'),
        libre('Champiñones y tomate cherry'),
        i('jamon-de-pollo-pavo', 'Jamón de pavo', 30, 'g'),
        i('queso-mozzarella-light', 'Queso mozzarella fresco light', 40, 'g'),
      ]),
    dish(2, 'cena', 'Ensalada caprese con pan y lomo',
      'Ensalada capresse: 1 bola de queso mozzarella fresco light, tomate 8g de pesto, albahaca y rúcula con 2 rebanadas de pan integral y 30g de lomo de cerdo asado La Carloteña.', [
        sinCalcular('1 bola de queso mozzarella fresco light', 'Peso de la bola no documentado.'),
        sinCalcular('8 g de pesto', 'No figura en las tablas.'),
        libre('Tomate, albahaca y rúcula'),
        i('pan-de-molde', 'Pan integral', 2, 'unidad', 'Contado como pan de molde.'),
        i('lomo-de-cerdo', 'Lomo de cerdo asado La Carloteña', 30, 'g'),
      ]),
    dish(3, 'cena', 'Crema de auyama con arepa de cottage y atún',
      'Crema de auyama. 1 arepa de cottage (40g de harina pan + 50g de queso cottage) 1 lata de atún natural mezclado con 30g de aguacate, 70g de yogur proteico, tomate y cebolla.', [
        i('vegetales-variados', 'Crema de auyama', 1, 'porcion', 'Auyama = calabaza. Porción interpretada.'),
        i('harina-de-maiz-pan', 'Harina de maíz (pan)', 40, 'g'),
        i('queso-cottage', 'Queso cottage', 50, 'g'),
        i('atun-al-natural-en-lata', 'Atún natural', 1, 'unidad', '1 lata'),
        i('aguacate', 'Aguacate', 30, 'g'),
        i('yogur-proteico-queso-fresco-batido-0', 'Yogur proteico', 70, 'g'),
        libre('Tomate y cebolla'),
      ]),
  ];
}
