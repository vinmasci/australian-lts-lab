import { NextRequest, NextResponse } from 'next/server';
import { parseOsmFeatureId } from '@/lib/osm-tags';

export const dynamic = 'force-dynamic';

interface OsmApiElement {
  type?: string;
  id?: number;
  timestamp?: string;
  tags?: Record<string, unknown>;
}

interface OsmApiResponse {
  elements?: OsmApiElement[];
}

function cleanTags(tags: Record<string, unknown> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(tags || {})
      .filter(([key, value]) => key.length <= 80 && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'))
      .slice(0, 150)
      .map(([key, value]) => [key, String(value).slice(0, 500)]),
  );
}

export async function GET(request: NextRequest) {
  const osmId = (request.nextUrl.searchParams.get('osmId') || '').trim();
  const parsed = parseOsmFeatureId(osmId);
  if (!parsed) return NextResponse.json({ error: 'Invalid OpenStreetMap feature ID.' }, { status: 400 });

  const sourceUrl = `https://www.openstreetmap.org/${parsed.type}/${parsed.id}`;
  const apiUrl = `https://api.openstreetmap.org/api/0.6/${parsed.type}/${parsed.id}.json`;

  try {
    const response = await fetch(apiUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Australian-LTS-Lab/1.0 (+https://ausbug.app/ltsmap)',
      },
      next: { revalidate: 3600 },
    });
    if (!response.ok) {
      return NextResponse.json({ error: response.status === 404 ? 'This OSM feature no longer exists.' : 'OpenStreetMap did not return this feature.' }, { status: response.status === 404 ? 404 : 502 });
    }

    const data = await response.json() as OsmApiResponse;
    const element = data.elements?.find((candidate) => candidate.type === parsed.type && candidate.id === parsed.id);
    if (!element) return NextResponse.json({ error: 'OpenStreetMap returned no matching feature.' }, { status: 404 });

    return NextResponse.json({
      osmId,
      type: parsed.type,
      id: parsed.id,
      tags: cleanTags(element.tags),
      updatedAt: element.timestamp || null,
      sourceUrl,
    }, { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400' } });
  } catch (error) {
    console.warn('[OSM feature tags]', error);
    return NextResponse.json({ error: 'Could not reach OpenStreetMap.' }, { status: 502 });
  }
}
