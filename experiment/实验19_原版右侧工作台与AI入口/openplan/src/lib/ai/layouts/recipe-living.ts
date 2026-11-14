import type { LayoutRecipe } from './types';

export default {
  id: 'living',
  label: 'Living room trio',
  items: [
    { catalogId: 'sofa', target: { x: 0.26, y: 0.5 } },
    { catalogId: 'coffee_table', target: { x: 0.5, y: 0.5 } },
    { catalogId: 'chair', target: { x: 0.74, y: 0.5 } },
  ],
} satisfies LayoutRecipe;
