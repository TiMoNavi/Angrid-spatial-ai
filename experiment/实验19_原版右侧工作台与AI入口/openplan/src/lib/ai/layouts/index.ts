import type { LayoutRecipe } from './types';

// Vite watches trusted local modules. New recipes appear in the UI and preview API after HMR/reload.
const modules = import.meta.glob('./recipe-*.ts', { eager: true, import: 'default' });
export const layoutRecipes: LayoutRecipe[] = Object.values(modules)
  .filter((value): value is LayoutRecipe => !!value && typeof value === 'object' &&
    typeof (value as LayoutRecipe).id === 'string' && Array.isArray((value as LayoutRecipe).items))
  .filter((recipe, index, all) => recipe.id !== 'single' && /^[a-z][a-z0-9-]{1,40}$/.test(recipe.id) &&
    recipe.items.length > 0 && recipe.items.length <= 12 && all.findIndex(other => other.id === recipe.id) === index)
  .sort((a, b) => a.id.localeCompare(b.id));

export type { LayoutRecipe } from './types';
