export function ltsFromCost(costPerKm: number): number {
  if (costPerKm <= 1200) return 1;
  if (costPerKm <= 1600) return 1.5;
  if (costPerKm <= 3000) return 2;
  if (costPerKm <= 9000) return 3;
  return 4;
}

export function precomputedLtsFromWayTags(wayTags: string): number | null {
  const reversed = wayTags.includes('reversedirection=yes');
  if (hasPlaceholder(wayTags, reversed ? 23 : 22)) return 4.5;
  const communityLts15Tag = reversed ? 19 : 18;
  if (hasPlaceholder(wayTags, communityLts15Tag)) return 1.5;
  const firstTag = reversed ? 8 : 4;
  for (let lts = 1; lts <= 4; lts += 1) {
    const tagNumber = String(firstTag + lts - 1).padStart(2, '0');
    if (wayTags.includes(`brouter_route_placeholder_dummy_${tagNumber}=dummy`)) return lts;
  }
  return null;
}

export function hasPlaceholder(wayTags: string, number: number): boolean {
  const tagNumber = String(number).padStart(2, '0');
  return wayTags.includes(`brouter_route_placeholder_dummy_${tagNumber}=dummy`);
}


/** Same walking classification as iOS; a pedestrian link has no cycling LTS. */
export function routeSectionRating(wayTags: string, costPerKm: number): { lts: number | null; requiresWalking: boolean } {
  const tags = Object.fromEntries([...wayTags.matchAll(/(?:^|[ ,])([^= ,]+)=([^ ,]+)/g)]
    .map(match => [match[1], match[2]]));
  const bicycle = tags.bicycle ?? '';
  const walking = ['dismount', 'no', 'use_sidepath', 'private'].includes(bicycle)
    || tags.highway === 'steps'
    || (['footway', 'pedestrian'].includes(tags.highway)
      && !['yes', 'designated', 'permissive'].includes(bicycle));
  const precomputed = precomputedLtsFromWayTags(wayTags);
  // Keep a forbidden 4.5 visible as such if an upstream response is ever inspected.
  // Walking must never downgrade an exclusion into an ordinary pedestrian connection.
  if (precomputed === 4.5) return { lts: 4.5, requiresWalking: false };
  return { lts: walking ? null : precomputed ?? ltsFromCost(costPerKm), requiresWalking: walking };
}
