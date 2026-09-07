export interface OsmFeatureDetails {
  osmId: string;
  type: 'node' | 'way' | 'relation';
  id: number;
  tags: Record<string, string>;
  updatedAt: string | null;
  sourceUrl: string;
}

export type BikeAccessKind = 'designated' | 'permitted' | 'conditional' | 'prohibited' | 'unconfirmed';

export interface BikeAccessAssessment {
  kind: BikeAccessKind;
  label: string;
  detail: string;
}

const POSITIVE_BICYCLE_VALUES = new Set(['yes', 'designated', 'official']);
const CONDITIONAL_BICYCLE_VALUES = new Set(['permissive', 'destination', 'customers', 'delivery', 'private']);
const PROHIBITED_BICYCLE_VALUES = new Set(['no', 'dismount', 'use_sidepath']);
const RESTRICTED_ACCESS_VALUES = new Set(['no', 'private']);
const CONDITIONAL_ACCESS_VALUES = new Set(['permissive', 'destination', 'customers', 'delivery']);
const PATH_HIGHWAYS = new Set(['footway', 'pedestrian', 'path', 'track', 'bridleway', 'steps']);

export function parseOsmFeatureId(value: string): { type: OsmFeatureDetails['type']; id: number } | null {
  const match = /^([nwr])(\d+)$/.exec(value.trim());
  if (!match) return null;
  const id = Number(match[2]);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const type = match[1] === 'n' ? 'node' : match[1] === 'w' ? 'way' : 'relation';
  return { type, id };
}

export function assessBikeAccess(tags: Record<string, string>, fallbackHighway = ''): BikeAccessAssessment {
  const bicycle = tags.bicycle?.toLowerCase();
  const highway = (tags.highway || fallbackHighway).toLowerCase();

  if (bicycle === 'designated' || bicycle === 'official') {
    return {
      kind: 'designated',
      label: 'Designated for bicycles',
      detail: `OSM explicitly records bicycle=${bicycle}. Check current signs and conditions on site.`,
    };
  }
  if (bicycle && POSITIVE_BICYCLE_VALUES.has(bicycle)) {
    return {
      kind: 'permitted',
      label: 'Bicycle access permitted',
      detail: `OSM explicitly records bicycle=${bicycle}. This permits access but does not necessarily mean the path is a designated cycleway.`,
    };
  }
  if (bicycle && PROHIBITED_BICYCLE_VALUES.has(bicycle)) {
    return {
      kind: 'prohibited',
      label: bicycle === 'dismount' ? 'Dismount required' : 'Bicycle access not permitted',
      detail: `OSM records bicycle=${bicycle}. The LTS score must not be treated as permission to ride here.`,
    };
  }
  if (bicycle && CONDITIONAL_BICYCLE_VALUES.has(bicycle)) {
    return {
      kind: 'conditional',
      label: `Conditional bicycle access (${bicycle})`,
      detail: 'Access is limited or permissive rather than an unrestricted public cycling designation.',
    };
  }

  if (highway === 'cycleway') {
    return {
      kind: 'designated',
      label: 'Designated cycleway',
      detail: 'OSM highway=cycleway normally implies bicycle designation. Check current signs and conditions on site.',
    };
  }

  for (const key of ['vehicle', 'access'] as const) {
    const value = tags[key]?.toLowerCase();
    if (value && RESTRICTED_ACCESS_VALUES.has(value)) {
      return {
        kind: 'prohibited',
        label: value === 'private' ? 'Private access' : 'Bicycle access not confirmed',
        detail: `OSM records ${key}=${value} and has no bicycle-specific override.`,
      };
    }
    if (value && CONDITIONAL_ACCESS_VALUES.has(value)) {
      return {
        kind: 'conditional',
        label: `Conditional access (${value})`,
        detail: `OSM records ${key}=${value} and has no bicycle-specific override.`,
      };
    }
  }

  if (PATH_HIGHWAYS.has(highway)) {
    return {
      kind: 'unconfirmed',
      label: 'Bicycle access not confirmed',
      detail: `OSM records highway=${highway} but no explicit bicycle permission. Check signs, the responsible authority or the site before treating it as rideable.`,
    };
  }

  return {
    kind: 'unconfirmed',
    label: 'No bicycle-specific OSM tag',
    detail: 'No bicycle restriction or designation is recorded. This is not a guarantee of legal or practical access.',
  };
}

const TAG_PRIORITY = [
  'name', 'highway', 'bicycle', 'foot', 'access', 'vehicle', 'motor_vehicle', 'motorcar',
  'cycleway', 'segregated', 'designation', 'surface', 'smoothness', 'lit', 'width',
  'oneway', 'maxspeed', 'sac_scale', 'mtb:scale', 'route', 'network',
];

export function orderedOsmTags(tags: Record<string, string>): Array<[string, string]> {
  const priority = new Map(TAG_PRIORITY.map((key, index) => [key, index]));
  return Object.entries(tags).sort(([left], [right]) => {
    const leftPriority = priority.get(left) ?? TAG_PRIORITY.length;
    const rightPriority = priority.get(right) ?? TAG_PRIORITY.length;
    return leftPriority - rightPriority || left.localeCompare(right);
  });
}
