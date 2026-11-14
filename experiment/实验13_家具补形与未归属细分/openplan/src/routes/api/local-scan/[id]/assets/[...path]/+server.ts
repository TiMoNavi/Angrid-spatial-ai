import type { RequestHandler } from './$types';
import { serveLayerAsset } from '$lib/server/layerAssets';

export const GET: RequestHandler = event => serveLayerAsset(event);
