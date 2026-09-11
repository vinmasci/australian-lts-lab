// City-level startup hint only. Never retain or cache a visitor's location.
export const dynamic = 'force-dynamic';

const STATES: Record<string, string> = {
  VIC: 'victoria', NSW: 'nsw', QLD: 'queensland', WA: 'western_australia',
  SA: 'south_australia', ACT: 'act', TAS: 'tasmania', NT: 'northern_territory',
};

export function GET(request: Request) {
  const headers = request.headers;
  const dataset = STATES[headers.get('x-vercel-ip-country-region') || ''];
  const lat = headers.get('x-vercel-ip-latitude');
  const lon = headers.get('x-vercel-ip-longitude');
  const latitude = Number(lat);
  const longitude = Number(lon);
  const australian = headers.get('x-vercel-ip-country') === 'AU' && dataset;
  const validPoint = lat && lon && Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= -44 && latitude <= -10 && longitude >= 112 && longitude <= 154;
  return Response.json(australian ? {
    dataset,
    // Round to roughly city/suburb precision; this is not a GPS position.
    center: validPoint ? [Math.round(longitude * 100) / 100, Math.round(latitude * 100) / 100] : null,
  } : null, { headers: {
    'Cache-Control': 'private, no-store, max-age=0',
    'Access-Control-Allow-Origin': '*',
  } });
}
