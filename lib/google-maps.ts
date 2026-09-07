export function googleStreetViewUrl([longitude, latitude]: [number, number]): string {
  const params = new URLSearchParams({
    api: '1',
    map_action: 'pano',
    viewpoint: `${latitude.toFixed(6)},${longitude.toFixed(6)}`,
  });
  return `https://www.google.com/maps/@?${params.toString()}`;
}
