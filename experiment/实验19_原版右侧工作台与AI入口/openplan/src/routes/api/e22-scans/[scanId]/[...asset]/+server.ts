import { checkE22Request, e22AssetResponse, e22ErrorResponse } from '$lib/server/e22Scans';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const blocked = checkE22Request(event);
  if (blocked) return blocked;
  try { return await e22AssetResponse(event.params.scanId, event.params.asset); }
  catch (error) { return e22ErrorResponse(error); }
};
