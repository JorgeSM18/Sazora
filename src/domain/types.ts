// Modelo de dominio de Sazora. Sin dependencias de UI ni de persistencia.

export const NUTRIENT_KEYS = ['kcal', 'protein', 'carbs', 'fat'] as const;
export type NutrientKey = (typeof NUTRIENT_KEYS)[number];
/** null = desconocido. Nunca se usa 0 para "no sabemos". */
export type Nutrients = Record<NutrientKey, number | null>;

export const EXCHANGE_GROUPS = [
  'lacteos',
  'vegetales',
  'frutas',
  'carbohidratos',
  'proteinaMagra',
  'proteinaSemimagra',
  'grasas',
] as const;
export type ExchangeGroup = (typeof EXCHANGE_GROUPS)[number];
export type Portions = Partial<Record<ExchangeGroup, number>>;

/** Unidades medibles. `porcion` = porción de intercambio; `racion` = ración de una receta. */
export type MeasureUnit = 'g' | 'ml' | 'unidad';
export type Unit = MeasureUnit | 'porcion' | 'racion';

export type FoodState = 'crudo' | 'cocido' | 'escurrido' | 'listo' | 'otro';
export type Verification = 'verificado' | 'pendiente';
export type Origin = 'documento' | 'usuario';

export interface SourceRef {
  doc: string; // id del documento (ver DOCUMENTS)
  page?: number;
  section?: string;
  /** Texto original tal como aparece en el PDF. */
  raw?: string;
}

export interface SourceDocument {
  id: string;
  title: string;
  file?: string;
  author?: string;
  version?: string;
  kind: DocumentKind;
  /** Dudas de la importación propias de este documento (p. ej. de la lista de alimentos). */
  review?: ReviewItem[];
  /** Contenido para mostrar como guía (tablas de crudo a cocido, productos por supermercado). */
  guide?: ConversionGuide | ProductGuide;
}

/** plan y lista-intercambios cambian poco; conversion y productos son guías de consulta. */
export type DocumentKind = 'plan' | 'lista-intercambios' | 'conversion' | 'productos';

export interface ConversionRow {
  names: string[];
  /** Alimentos del catálogo a los que se aplica (crudo). */
  foodIds: string[];
  section: string;
  group: ExchangeGroup;
  rawGrams: number;
  cookedMin: number;
  cookedMax: number;
  page: number;
}

export interface ConversionGuide {
  type: 'conversion';
  rules: { text: string; page: number }[];
  rows: ConversionRow[];
  notes: { text: string; page: number }[];
}

export interface GuideProduct {
  name: string;
  category: string;
  /** Alimento creado a partir del producto (si tiene equivalencia). */
  foodId?: string;
  equivalence: string;
  raw: string;
  page: number;
}

export interface ProductGuide {
  type: 'productos';
  stores: { store: string; products: GuideProduct[] }[];
}

/** "amount unit de este alimento = portions". Puede repartir en varios grupos (p. ej. focaccia). */
export interface PortionEquivalence {
  amount: number;
  unit: MeasureUnit | 'porcion';
  portions: Portions;
  householdMeasure?: string;
  source: SourceRef;
  status: Verification;
  note?: string;
}

export interface FoodNutrition {
  per: number;
  unit: MeasureUnit;
  values: Nutrients;
  source: string;
  status: Verification;
}

export interface Food {
  id: string;
  name: string;
  brand?: string;
  state: FoodState;
  /** Grupo de intercambio principal, si lo tiene. */
  group?: ExchangeGroup;
  /** Cómo se llama "1 unidad" (rebanada, loncha, scoop...). */
  unitLabel?: string;
  nutrition?: FoodNutrition;
  equivalences: PortionEquivalence[];
  origin: Origin;
  status: Verification;
  notes?: string;
}

export interface MealSlot {
  id: string;
  name: string;
  time?: string;
  portionTargets: Portions;
}

export type RuleKind = 'libre' | 'equivalencia' | 'sustitucion' | 'restriccion' | 'consejo';
export interface DietRule {
  id: string;
  kind: RuleKind;
  text: string;
  source: SourceRef;
  status: Verification;
}

export interface ReviewItem {
  id: string;
  text: string;
  source: SourceRef;
  resolved: boolean;
}

export type NutrientTargets = Partial<Record<NutrientKey, number>>;

export interface Diet {
  id: string;
  name: string;
  /** Persona a la que pertenece la pauta. */
  holder: string;
  documents: string[];
  documentVersion?: string;
  importedAt: string;
  status: Verification;
  notes: string[];
  meals: MealSlot[];
  dailyPortionTargets: Portions;
  /** Solo si están documentados o el usuario los configura. Vacío por defecto. */
  nutrientTargets: NutrientTargets;
  nutrientTargetsSource?: 'documento' | 'usuario';
  /** Orden de precedencia de documentos al buscar equivalencias. */
  exchangeDocs: string[];
  rules: DietRule[];
  /** Alimentos que la pauta indica expresamente no contabilizar. */
  freeFoodIds: string[];
  review: ReviewItem[];
}

export interface Ingredient {
  /** Sin foodId = ingrediente de texto libre: se muestra pero no se calcula. */
  foodId?: string;
  label: string;
  quantity?: number;
  unit?: MeasureUnit | 'porcion';
  note?: string;
}

export interface Recipe {
  id: string;
  name: string;
  description: string;
  ingredients: Ingredient[];
  servings: number;
  steps: string[];
  prepMinutes?: number;
  category: string;
  tags: string[];
  origin: Origin;
  mealHint?: string;
  source?: SourceRef;
  status: Verification;
  favorite: boolean;
  createdAt: string;
}

export type ItemRef = { kind: 'food'; foodId: string } | { kind: 'recipe'; recipeId: string };

export interface PlanItem {
  id: string;
  date: string; // YYYY-MM-DD
  mealId: string;
  order: number;
  ref: ItemRef;
  quantity: number;
  unit: Unit;
}

export interface IntakeEntry {
  id: string;
  date: string;
  mealId: string;
  ref: ItemRef;
  quantity: number;
  unit: Unit;
  planItemId?: string;
  status: 'registrado' | 'corregido';
  loggedAt: string;
}

export interface AppData {
  schemaVersion: number;
  fixturesVersion: number;
  documents: SourceDocument[];
  /** La pauta importada. Solo hay una: todo (porciones, alimentos, platos) gira en torno a ella. null hasta importarla. */
  diet: Diet | null;
  foods: Food[];
  recipes: Recipe[];
  plan: PlanItem[];
  intake: IntakeEntry[];
}

export const GROUP_LABELS: Record<ExchangeGroup, string> = {
  lacteos: 'Lácteos',
  vegetales: 'Vegetales',
  frutas: 'Frutas',
  carbohidratos: 'Carbohidratos',
  proteinaMagra: 'Proteína magra',
  proteinaSemimagra: 'Proteína semimagra',
  grasas: 'Grasas',
};

export const NUTRIENT_LABELS: Record<NutrientKey, { label: string; unit: string }> = {
  kcal: { label: 'Energía', unit: 'kcal' },
  protein: { label: 'Proteínas', unit: 'g' },
  carbs: { label: 'Carbohidratos', unit: 'g' },
  fat: { label: 'Grasas', unit: 'g' },
};
