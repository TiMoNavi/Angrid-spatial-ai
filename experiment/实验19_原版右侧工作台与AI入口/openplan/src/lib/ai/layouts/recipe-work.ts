import type { LayoutRecipe } from './types';

export default {
  id: 'work',
  label: 'Work corner trio',
  items: [
    { catalogId: 'desk', target: { x: 0.28, y: 0.3 } },
    { catalogId: 'office_chair', target: { x: 0.5, y: 0.5 } },
    { catalogId: 'bookshelf', target: { x: 0.72, y: 0.3 } },
  ],
} satisfies LayoutRecipe;
