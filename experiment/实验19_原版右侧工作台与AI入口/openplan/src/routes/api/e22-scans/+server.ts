import { json } from '@sveltejs/kit';
import { checkE22Request, e22ErrorResponse, E22ScanError, importE22Zip, listE22Scans } from '$lib/server/e22Scans';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const blocked = checkE22Request(event);
  if (blocked) return blocked;
  try { return json({ scans: await listE22Scans() }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return e22ErrorResponse(error); }
};

export const POST: RequestHandler = async (event) => {
  const blocked = checkE22Request(event);
  if (blocked) return blocked;
  const raw = event.url.searchParams.get('roomIndex');
  if (raw !== null && !/^(?:0|[1-9][0-9]*)$/.test(raw)) return e22ErrorResponse(new E22ScanError(400, 'roomIndex must be a nonnegative integer.'));
  const roomIndex = raw === null ? null : Number(raw);
  try { return json(await importE22Zip(event.request, roomIndex), { status: 201, headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return e22ErrorResponse(error); }
};
