export const UNLOCK_REQUIREMENTS = [
  'card', 'journal', 'rack', 'archiveRecovered', 'identity', 'password', 'reportConfirmed',
  'coupler', 'coolingRestored', 'passageSafe'
];

export const SCAN_FIELDS = {A: 'scannedA', B: 'scannedB'};
export const SCAN_ACTIONS = {A: 'scan_route_a', B: 'scan_route_b'};
export const ECHO_FIELDS = [...UNLOCK_REQUIREMENTS, 'alignedPipe', ...Object.values(SCAN_FIELDS), 'unlocked', 'escaped'];
export const ECHO_ACTIONS = ['reply', 'recover_archive', 'align_pipe', ...Object.values(SCAN_ACTIONS), 'request_unlock'];

export function initialState() {
  return {
    card: false, journal: false, rack: false, archiveRecovered: false, identity: false, password: false,
    reportOpen: false, reportConfirmed: false, coupler: false, coolingRestored: false,
    alignedPipe: false, scannedA: false, scannedB: false,
    passageSafe: false, route: null,
    unlocked: false, escaped: false
  };
}

export function canUnlock(state) {
  return UNLOCK_REQUIREMENTS.every(key => state[key] === true) &&
    Object.hasOwn(SCAN_FIELDS, state.route) && state[SCAN_FIELDS[state.route]] === true &&
    !state.unlocked && !state.escaped;
}

export function canEchoAct(state, action) {
  if (action === 'reply') return true;
  if (state.unlocked || state.escaped) return false;
  switch (action) {
    case 'recover_archive': return state.rack && !state.archiveRecovered;
    case 'align_pipe': return state.reportConfirmed && state.coupler && !state.coolingRestored && !state.alignedPipe;
    case SCAN_ACTIONS.A: return state.coolingRestored && !state.scannedA && !state.passageSafe;
    case SCAN_ACTIONS.B: return state.coolingRestored && !state.scannedB && !state.passageSafe;
    case 'request_unlock': return canUnlock(state);
    default: return false;
  }
}
