import { localScan } from '$lib/server/localScan';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = (event) => localScan(event, 'depth');
