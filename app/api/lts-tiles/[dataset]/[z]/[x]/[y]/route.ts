import { NextRequest } from 'next/server';
import { PMTiles, SharedPromiseCache } from 'pmtiles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ARCHIVE_URLS = {
  victoria: process.env.NEXT_PUBLIC_VICTORIA_PMTILES_URL
    || 'https://storage.googleapis.com/cyaroutes.firebasestorage.app/public/lts/victoria-lts-9b3a9942.pmtiles',
  nsw: process.env.NEXT_PUBLIC_NSW_PMTILES_URL
    || 'https://storage.googleapis.com/cyaroutes.firebasestorage.app/public/lts/nsw-lts-d4fdc970.pmtiles',
  queensland: process.env.NEXT_PUBLIC_QUEENSLAND_PMTILES_URL
    || 'https://storage.googleapis.com/cyaroutes.firebasestorage.app/public/lts/queensland-lts-c0dd9f26.pmtiles',
  western_australia: process.env.NEXT_PUBLIC_WA_PMTILES_URL
    || 'https://storage.googleapis.com/cyaroutes.firebasestorage.app/public/lts/western-australia-lts-64573cc9.pmtiles',
  south_australia: process.env.NEXT_PUBLIC_SA_PMTILES_URL
    || 'https://storage.googleapis.com/cyaroutes.firebasestorage.app/public/lts/south-australia-lts-d579551c.pmtiles',
  act: process.env.NEXT_PUBLIC_ACT_PMTILES_URL
    || 'https://storage.googleapis.com/cyaroutes.firebasestorage.app/public/lts/act-lts-166671dc.pmtiles',
  tasmania: process.env.NEXT_PUBLIC_TASMANIA_PMTILES_URL
    || 'https://storage.googleapis.com/cyaroutes.firebasestorage.app/public/lts/tasmania-lts-ee99da23.pmtiles',
  northern_territory: process.env.NEXT_PUBLIC_NT_PMTILES_URL
    || 'https://storage.googleapis.com/cyaroutes.firebasestorage.app/public/lts/northern-territory-lts-e6f8e235.pmtiles',
} as const;

type Dataset = keyof typeof ARCHIVE_URLS;

// Reuse archive directory reads across warm serverless requests. Tile bodies are
// cached at the HTTP edge and by the mobile map SDKs.
const directoryCache = new SharedPromiseCache(256);
const archives = new Map<Dataset, PMTiles>();

function archiveFor(dataset: Dataset): PMTiles {
  const existing = archives.get(dataset);
  if (existing) return existing;
  const archive = new PMTiles(ARCHIVE_URLS[dataset], directoryCache);
  archives.set(dataset, archive);
  return archive;
}

function isDataset(value: string): value is Dataset {
  return Object.prototype.hasOwnProperty.call(ARCHIVE_URLS, value);
}

function tileCoordinate(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ dataset: string; z: string; x: string; y: string }> },
) {
  const path = await params;
  if (!isDataset(path.dataset)) {
    return new Response('Unknown LTS dataset', { status: 404 });
  }

  const z = tileCoordinate(path.z);
  const x = tileCoordinate(path.x);
  const y = tileCoordinate(path.y.replace(/\.pbf$/i, ''));
  if (z === null || x === null || y === null || z > 22 || x >= 2 ** z || y >= 2 ** z) {
    return new Response('Invalid tile coordinate', { status: 400 });
  }

  try {
    const tile = await archiveFor(path.dataset).getZxy(z, x, y, request.signal);
    if (!tile) return new Response(null, { status: 204 });

    return new Response(tile.data, {
      headers: {
        'Content-Type': 'application/vnd.mapbox-vector-tile',
        'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('[LTS tiles]', path.dataset, z, x, y, error);
    return new Response('Unable to read LTS tile', { status: 502 });
  }
}
