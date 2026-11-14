/** Trusted local recipe. Files in this folder are bundled by Vite, not sandboxed scripts. */
export interface LayoutRecipe {
  id: string;
  label: string;
  items: { catalogId: string; target: { x: number; y: number }; rotations?: (0 | 90)[] }[];
}
