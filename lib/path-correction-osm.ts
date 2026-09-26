import 'server-only';
import { publishedPathCorrections } from '@/lib/path-correction-store';
import { pathApprovalError, type PublishedPathCorrection } from '@/lib/path-corrections';

export async function currentPath(osmId: string) {
  if (!/^w[1-9][0-9]*$/.test(osmId)) throw new Error('A valid OSM way is required.');
  const id = Number(osmId.slice(1));
  const response = await fetch(`https://api.openstreetmap.org/api/0.6/way/${id}/full.json`, {
    headers: { Accept: 'application/json', 'User-Agent': 'AusBUG-LTS/1.0 (+https://ausbug.app/ltsmap)' },
    next: { revalidate: 300 }, signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error('Could not verify the current OSM path.');
  const payload = await response.json() as { elements: Array<{ type: string; id: number; version?: number; tags?: Record<string, string>; nodes?: number[]; lon?: number; lat?: number }> };
  const way = payload.elements.find(e => e.type === 'way' && e.id === id);
  if (!way?.version || !way.nodes) throw new Error('OSM path evidence is incomplete.');
  const nodes = new Map(payload.elements.filter(e => e.type === 'node').map(e => [e.id, [e.lon!, e.lat!]]));
  const coordinates = way.nodes.map(n => nodes.get(n));
  if (coordinates.length < 2 || coordinates.some(p => !p || !p.every(Number.isFinite))) throw new Error('OSM path geometry is incomplete.');
  return { tags: way.tags || {}, version: way.version, geometry: { type: 'LineString' as const, coordinates: coordinates as number[][] } };
}
// Changed or unavailable OSM evidence withholds an override; it never relaxes access.
export async function currentPublishedPaths(dataset: string): Promise<PublishedPathCorrection[]> {
  const records = await publishedPathCorrections(dataset);
  const result: PublishedPathCorrection[] = [];
  for (let start = 0; start < records.length; start += 6) {
    const batch = await Promise.all(records.slice(start, start + 6).map(async record => {
      try {
        const evidence = await currentPath(record.segment.osmId!);
        return evidence.version === record.osmVersion && !pathApprovalError(evidence.tags, record.pathType) ? record : null;
      } catch { return null; }
    }));
    result.push(...batch.filter((r): r is PublishedPathCorrection => r !== null));
  }
  return result;
}
