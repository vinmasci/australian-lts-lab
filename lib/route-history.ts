type Coordinate = [number, number];
export const MAX_ROUTE_POINTS = 26;
export const initialRouteHistory: { snapshots: Coordinate[][]; index: number } = { snapshots: [[]], index: 0 };
type Action = { type: 'add'; point: Coordinate } | { type: 'remove'; index: number } | { type: 'undo' | 'redo' | 'reverse' | 'clear' | 'reset' };
export function routeHistoryReducer(state: typeof initialRouteHistory, action: Action): typeof initialRouteHistory {
  const points = state.snapshots[state.index];
  if (action.type === 'reset') return initialRouteHistory;
  if (action.type === 'undo') return { ...state, index: Math.max(0, state.index - 1) };
  if (action.type === 'redo') return { ...state, index: Math.min(state.snapshots.length - 1, state.index + 1) };
  let next: Coordinate[];
  switch (action.type) {
    case 'add':
      if (points.length >= MAX_ROUTE_POINTS) return state;
      next = [...points, action.point]; break;
    case 'remove':
      if (action.index < 0 || action.index >= points.length) return state;
      next = points.filter((_, index) => index !== action.index); break;
    case 'reverse':
      if (points.length < 2) return state;
      next = [...points].reverse(); break;
    case 'clear':
      if (!points.length) return state;
      next = []; break;
  }
  // New edits after undo discard the abandoned future, rather than replaying stale stops.
  const snapshots = [...state.snapshots.slice(0, state.index + 1), next];
  return { snapshots, index: snapshots.length - 1 };
}
