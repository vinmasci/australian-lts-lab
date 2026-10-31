/** Public profile names match the AusBUG mobile planner. Only these engine IDs are accepted. */
export const LTS_ROUTE_PROFILES = {
  cyalts: { label: 'Low Stress', description: 'Favours lower traffic stress and excludes LTS 4.5 links.' },
  cyabikepath: { label: 'Bike Paths', description: 'Favours cycleways and shared paths over roads.' },
  cyabalanced: { label: 'Bike Lanes', description: 'Balances cycleways, bike lanes and connecting streets.' },
  cyaroads: { label: 'Roads', description: 'Favours direct roads and bike lanes; may include high traffic stress.' },
} as const;
export type LtsRoutingProfile = keyof typeof LTS_ROUTE_PROFILES;
export function parseRoutingProfile(value: unknown): LtsRoutingProfile | null {
  if (value === undefined) return 'cyalts';
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LTS_ROUTE_PROFILES, value)
    ? value as LtsRoutingProfile : null;
}
