import {AIRLOCK_ACTIONS, airlockContext, initialAirlock} from './airlock.mjs';
import {ROOMS} from './room.mjs';
import {ECHO_FIELDS, validPipeNumber} from './rules.mjs';

export const TIMELINE_LIMIT = 16;

export function progressSnapshot(state, room) {
  const fields = Object.fromEntries(ECHO_FIELDS.map(field => [field, state[field]]));
  const airlock = Object.fromEntries(Object.entries(airlockContext(state.airlock))
    .map(([field, value]) => ['airlock.' + field, value]));
  return {...fields, ...airlock, room, route: state.route, coolingFaultRow: state.coolingFaultRow};
}

const airlockFields = airlockContext(initialAirlock());
const booleanFields = new Set([...ECHO_FIELDS, ...Object.keys(airlockFields)
  .filter(field => typeof airlockFields[field] === 'boolean').map(field => 'airlock.' + field)]);

function validChange(field, value) {
  if (booleanFields.has(field)) return typeof value === 'boolean';
  if (field === 'room') return typeof value === 'string' && Object.hasOwn(ROOMS, value);
  if (field === 'route') return [null, 'A', 'B'].includes(value);
  if (field === 'coolingFaultRow') return value === null || validPipeNumber(value);
  if (field === 'airlock.innerDoorClosed') return value === null || typeof value === 'boolean';
  if (field === 'airlock.schedule') return [null, AIRLOCK_ACTIONS.onEntry, AIRLOCK_ACTIONS.afterClosing].includes(value);
  return false;
}

export function validProgressTimeline(timeline) {
  return Array.isArray(timeline) && timeline.length <= TIMELINE_LIMIT && timeline.every((event, index) => {
    if (!event || !Number.isSafeInteger(event.atMs) || event.atMs < 0 ||
        (index > 0 && event.atMs < timeline[index - 1].atMs) ||
        !event.changes || typeof event.changes !== 'object' || Array.isArray(event.changes)) return false;
    const changes = Object.entries(event.changes);
    return changes.length > 0 && changes.every(([field, value]) => validChange(field, value));
  });
}
