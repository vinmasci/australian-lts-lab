/** Keep the workshop implementation available for a later release. */
export const WORKSHOP_ENABLED = process.env.NEXT_PUBLIC_LTS_WORKSHOP_ENABLED === 'true';
export type WorkshopQuery = Record<string, string | string[] | undefined>;
export function hiddenWorkshopUrl(query: WorkshopQuery): string {
  const params = new URLSearchParams();
  const lga = Array.isArray(query.lga) ? query.lga[0] : query.lga;
  if (lga) params.set('lga', lga);
  return '/ltsmap' + (params.size ? '?' + params.toString() : '');
}
