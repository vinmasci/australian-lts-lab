import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { fromVectorTileJs } from 'vt-pbf';

/**
 * Installed mobile apps highlight every routable dismount feature by default.
 * Ordinary footways added as inferred walking context by the national rebuild
 * must not enter that display layer. Retain signed/reviewed dismount links and
 * all cycling features, with their original geometry and properties.
 */
export function removeInferredWalkingContext(data: Uint8Array): Uint8Array {
  const tile = new VectorTile(new Pbf(data));
  const layer = tile.layers.lts;
  if (!layer) return data;
  const features = Array.from({ length: layer.length }, (_, index) => layer.feature(index));
  const retained = features.filter(({ properties: p }) => !(
    p.feature_kind === 'dismount'
    && p.confidence === 'inferred_walking'
    && p.bicycle !== 'dismount'
    && !p.walking_override
    && p.community_path_type !== 'walking'
  ));
  if (retained.length === features.length) return data;
  layer.length = retained.length;
  layer.feature = (index: number) => retained[index];
  return fromVectorTileJs(tile as unknown as Parameters<typeof fromVectorTileJs>[0]);
}
