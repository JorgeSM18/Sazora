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
import { useStore } from './state/store';

export function App() {
  const { segments, query } = useRoute();
  const [section = 'inicio', id, action, ...rest] = segments;
  const date = query.get('fecha');
  const { data } = useStore();

  // La app vive en "/" con rutas tras "#". Cualquier otra ruta del servidor es un 404.
  const atRoot = ['/', '/index.html'].includes(window.location.pathname);

  let screen = <NotFound />;
  if (atRoot && rest.length === 0 && !data.diet) {
    // Sin pauta todavía: solo se puede importar o consultar alimentos; el resto lleva a la bienvenida.
    if (section === 'dieta' && id === 'importar' && !action) screen = <ImportScreen />;
    else if (section === 'guias' && !action) screen = <GuideRoute id={id} />;
    else if (section === 'compra' && !id) screen = <ShoppingScreen />;
    else if (section === 'alimentos' && !id) screen = <FoodsScreen />;
    else if (section === 'alimentos' && id && !action) screen = <FoodEditor foodId={id === 'nuevo' ? undefined : id} />;
    else if (['inicio', 'dieta', 'plan', 'recetas'].includes(section)) screen = <WelcomeScreen />;
  } else if (atRoot && rest.length === 0) {
    if (section === 'inicio' && !id) screen = <HomeScreen dateParam={date} />;
    else if (section === 'dieta' && !id) screen = <DietScreen />;
    else if (section === 'dieta' && id === 'importar' && !action) screen = <ImportScreen />;
    else if (section === 'guias' && !action) screen = <GuideRoute id={id} />;
    else if (section === 'compra' && !id) screen = <ShoppingScreen />;
    else if (section === 'plan' && !id) screen = <PlannerScreen dateParam={date} />;
    else if (section === 'recetas' && !id) screen = <RecipesScreen />;
    else if (section === 'recetas' && id === 'nueva' && !action) screen = <RecipeEditor />;
    else if (section === 'recetas' && id && action === 'editar') screen = <RecipeEditor recipeId={id} />;
    else if (section === 'recetas' && id && !action) screen = <RecipeDetail recipeId={id} />;
    else if (section === 'alimentos' && !id) screen = <FoodsScreen />;
    else if (section === 'alimentos' && id && !action) screen = <FoodEditor foodId={id === 'nuevo' ? undefined : id} />;
  }

  return <AppShell section={section}>{screen}</AppShell>;
}
