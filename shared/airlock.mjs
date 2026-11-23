import {DEFAULT_LOCALE, phrase, translate} from './i18n.mjs';

export const AIRLOCK_ACTIONS = {
  now: 'open_outer_now',
  onEntry: 'open_outer_on_entry',
  afterClosing: 'open_outer_after_inner_closed'
};

const phases = ['outside', 'closing', 'closed', 'rejected', 'open'];
const schedules = [null, AIRLOCK_ACTIONS.onEntry, AIRLOCK_ACTIONS.afterClosing];

export function initialAirlock() {
  return {authorized: false, phase: 'outside', spare: false, sensor: false, schedule: null};
}

export function validAirlock(airlock) {
  return airlock && typeof airlock.authorized === 'boolean' && typeof airlock.spare === 'boolean' &&
    typeof airlock.sensor === 'boolean' && phases.includes(airlock.phase) && schedules.includes(airlock.schedule) &&
    (!airlock.sensor || airlock.spare) && (airlock.authorized || airlock.phase === 'outside') &&
    (!airlock.schedule || canControlAirlock(airlock, airlock.schedule));
}

export function airlockContext({authorized, phase, sensor, schedule}) {
  return {
    authorized, sensorOnline: sensor, schedule,
    inChamber: phase !== 'outside',
    innerDoorClosed: sensor ? ['closed', 'open'].includes(phase) : null,
    interlockRejected: phase === 'rejected'
  };
}

export function canControlAirlock(airlock, action) {
  if (!airlock?.authorized) return false;
  const {phase, sensor} = airlock;
  switch (action) {
    case AIRLOCK_ACTIONS.now: return phase === 'closing' || phase === 'closed';
    case AIRLOCK_ACTIONS.onEntry: return phase === 'outside';
    case AIRLOCK_ACTIONS.afterClosing: return sensor && (phase === 'outside' || phase === 'closing');
    default: return false;
  }
}

function transferPower(state, locale) {
  const airlock = state.airlock;
  airlock.schedule = null;
  if (airlock.phase !== 'closed') {
    airlock.phase = 'rejected';
    return translate(locale, '联锁拒绝切电。内门还没关严，外门保持锁定。请退出缓冲舱后重试。');
  }
  airlock.phase = 'open';
  state.unlocked = true;
  return translate(locale, phrase('{route} 通道外门已打开。关闭面板，沿绿灯撤离。', {route: state.route}));
}

export function applyAirlockAction(state, action, locale = DEFAULT_LOCALE) {
  if (!canControlAirlock(state.airlock, action)) return translate(locale, '缓冲舱状态已变化，请重新请求。');
  if (action === AIRLOCK_ACTIONS.now) return transferPower(state, locale);
  state.airlock.schedule = action;
  return translate(locale, action === AIRLOCK_ACTIONS.onEntry
    ? '已登记指令：检测到你进入缓冲舱时切电。'
    : '已登记指令：传感器确认内门关严后切电。');
}

export function enterChamber(state, locale = DEFAULT_LOCALE) {
  const airlock = state.airlock;
  if (!airlock.authorized || airlock.phase !== 'outside') return;
  airlock.phase = 'closing';
  if (airlock.schedule === AIRLOCK_ACTIONS.onEntry) return transferPower(state, locale);
  return translate(locale, '已进入缓冲舱。内门正在关闭。');
}

export function finishClosing(state, locale = DEFAULT_LOCALE) {
  const airlock = state.airlock;
  if (airlock.phase !== 'closing') return;
  airlock.phase = 'closed';
  if (airlock.schedule === AIRLOCK_ACTIONS.afterClosing) return transferPower(state, locale);
  return translate(locale, '内门已关严，现场联锁指示灯变绿。');
}

export function leaveChamber(airlock, locale = DEFAULT_LOCALE) {
  if (airlock.phase === 'outside' || airlock.phase === 'open') return;
  airlock.phase = 'outside';
  airlock.schedule = null;
  return translate(locale, '已退回实验室，缓冲舱已复位。');
}
