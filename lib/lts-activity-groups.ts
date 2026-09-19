import type { PublicLtsContribution } from './lts-voting';

export interface Activity {
  id: string;
  dataset: string;
  name: string;
  updatedAt: string;
  status: 'published' | 'pending';
  baseLts: number | null;
  lts: number | null;
  publishedAt: string | null;
  contributions: PublicLtsContribution[];
  center: [number, number] | null;
}

// Names alone are not unique: keep distant namesakes and unnamed roads separate.
export function groupRoadActivity(items: Activity[]): Activity[][] {
  const groups: Activity[][] = [];
  const seen = new Set<string>();
  for (const item of [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    const id = `${item.dataset}/${item.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const name = item.name.trim().toLowerCase();
    const group = groups.find(([first]) => {
      if (!name || name.startsWith('unnamed') || first.dataset !== item.dataset
        || first.name.trim().toLowerCase() !== name || !first.center || !item.center) return false;
      const [lon, lat] = first.center;
      const [otherLon, otherLat] = item.center;
      const km = Math.hypot((lon - otherLon) * 111 * Math.cos(lat * Math.PI / 180), (lat - otherLat) * 111);
      return km <= 3;
    });
    if (group) group.push(item);
    else groups.push([item]);
  }
  return groups;
}
