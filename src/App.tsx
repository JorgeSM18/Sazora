import { Fragment, useEffect } from 'react';
import { AppShell } from './ui/AppShell';
import { useRoute } from './ui/router';
import { HomeScreen } from './ui/screens/HomeScreen';
import { DietScreen } from './ui/screens/DietScreen';
import { ImportScreen } from './ui/screens/ImportScreen';
import { PlannerScreen } from './ui/screens/PlannerScreen';
import { RecipesScreen } from './ui/screens/RecipesScreen';
import { RecipeDetail } from './ui/screens/RecipeDetail';
import { RecipeEditor } from './ui/screens/RecipeEditor';
import { FoodsScreen } from './ui/screens/FoodsScreen';
import { FoodEditor } from './ui/screens/FoodEditor';
import { NotFound } from './ui/screens/NotFound';
import { WelcomeScreen } from './ui/screens/WelcomeScreen';
import { GuideRoute } from './ui/screens/GuidesScreen';
import { ShoppingScreen } from './ui/screens/ShoppingScreen';
import { ReviewScreen } from './ui/screens/ReviewScreen';
import { SettingsScreen } from './ui/screens/SettingsScreen';
import { useStore } from './state/store';

export function App() {
  const { segments, query } = useRoute();
  const [section = 'inicio', id, action, ...rest] = segments;
  const date = query.get('fecha');
  const meal = query.get('comida');
  const { data } = useStore();
  // Al cambiar de pantalla se empieza arriba (con rutas por hash, el navegador conserva el scroll de la anterior),
  // salvo si se pide una comida concreta del plan: entonces la propia pantalla baja hasta ella.
  const path = segments.join('/');
  useEffect(() => {
    if (!meal) window.scrollTo(0, 0);
  }, [path, meal]);

  // La app vive en "/" con rutas tras "#". Cualquier otra ruta del servidor es un 404.
  const atRoot = ['/', '/index.html'].includes(window.location.pathname);

  // Sin pauta todavía: solo existe la pantalla de subida, sin menú, para empezar por ahí.
  if (!data.diet) return <AppShell section={section} bare>{atRoot ? <WelcomeScreen /> : <NotFound />}</AppShell>;

  let screen = <NotFound />;
  if (atRoot && rest.length === 0) {
    if (section === 'inicio' && !id) screen = <HomeScreen dateParam={date} />;
    else if (section === 'dieta' && !id) screen = <DietScreen />;
    else if (section === 'dieta' && id === 'importar' && !action) screen = <ImportScreen />;
    else if (section === 'guias' && !action) screen = <GuideRoute id={id} />;
    else if (section === 'dudas' && !id) screen = <ReviewScreen />;
    else if (section === 'ajustes' && !id) screen = <SettingsScreen />;
    else if (section === 'compra' && !id) screen = <ShoppingScreen />;
    else if (section === 'plan' && !id) screen = <PlannerScreen dateParam={date} mealParam={meal} />;
    else if (section === 'recetas' && !id) screen = <RecipesScreen />;
    else if (section === 'recetas' && id === 'nueva' && !action) screen = <RecipeEditor />;
    else if (section === 'recetas' && id && action === 'editar') screen = <RecipeEditor recipeId={id} />;
    else if (section === 'recetas' && id && !action) screen = <RecipeDetail recipeId={id} />;
    else if (section === 'alimentos' && !id) screen = <FoodsScreen />;
    else if (section === 'alimentos' && id && !action) screen = <FoodEditor foodId={id === 'nuevo' ? undefined : id} />;
  }

  // El importador cuelga de Documentos en el menú.
  // key: cada ruta monta su pantalla de cero. Si no, React reutiliza la anterior con su estado
  // (p. ej. "Nueva receta" aparecía rellena con la receta que se acababa de editar).
  return <AppShell section={section === 'dieta' && id === 'importar' ? 'guias' : section}><Fragment key={path}>{screen}</Fragment></AppShell>;
}
