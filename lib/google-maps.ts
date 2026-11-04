export function googleStreetViewUrl([longitude, latitude]: [number, number]): string {
  const params = new URLSearchParams({
    api: '1',
    map_action: 'pano',
    viewpoint: `${latitude.toFixed(6)},${longitude.toFixed(6)}`,
  });
  return `https://www.google.com/maps/@?${params.toString()}`;
}

/** Client coordinates become map CSS pixels, including when a sidebar shifts the canvas. */
export function streetViewCanvasPoint(rect:{left:number;top:number;width:number;height:number},[clientX,clientY]:[number,number]):[number,number]|null{
  const x=clientX-rect.left,y=clientY-rect.top;
  if(![x,y,rect.width,rect.height].every(Number.isFinite)||rect.width<=0||rect.height<=0||x<0||y<0||x>=rect.width||y>=rect.height)return null;
  return [x,y];
}
