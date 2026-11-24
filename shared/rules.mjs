import {AIRLOCK_ACTIONS, canControlAirlock, initialAirlock} from './airlock.mjs';
import {phrase} from './i18n.mjs';
import {GRID_SIZE} from './puzzles.mjs';

export const UNLOCK_REQUIREMENTS = [
  'card', 'journal', 'rack', 'archiveRecovered', 'identity', 'password', 'reportConfirmed',
  'coupler', 'coolingRestored', 'passageSafe'
];

export const SCAN_FIELDS = {A: 'scannedA', B: 'scannedB'};
export const SCAN_ACTIONS = {A: 'scan_route_a', B: 'scan_route_b'};
export const ECHO_FIELDS = [...UNLOCK_REQUIREMENTS, 'alignedPipe', ...Object.values(SCAN_FIELDS), 'unlocked', 'escaped'];
export const ECHO_ACTIONS = [
  'reply', 'recover_archive', 'align_pipe', 'isolate_pipe', ...Object.values(SCAN_ACTIONS), 'request_unlock', ...Object.values(AIRLOCK_ACTIONS)
];

export function initialState() {
  return {
    card: false, journal: false, rack: false, archiveRecovered: false, identity: false, password: false,
    reportOpen: false, reportConfirmed: false, coupler: false, coolingRestored: false, coolingFaultRow: null,
    alignedPipe: false, scannedA: false, scannedB: false,
    passageSafe: false, route: null,
    unlocked: false, escaped: false, airlock: initialAirlock()
  };
}

export function canUnlock(state) {
  return UNLOCK_REQUIREMENTS.every(key => state[key] === true) &&
    Object.hasOwn(SCAN_FIELDS, state.route) && state[SCAN_FIELDS[state.route]] === true &&
    !state.unlocked && !state.escaped && !state.airlock?.authorized;
}

export function canEchoAct(state, action) {
  if (action === 'reply') return true;
  if (state.unlocked || state.escaped) return false;
  switch (action) {
    case 'recover_archive': return state.rack && !state.archiveRecovered;
    case 'align_pipe': return state.reportConfirmed && state.coupler && !state.coolingRestored && !state.alignedPipe && !Object.hasOwn(state, 'coolingFaultRow');
    case 'isolate_pipe': return state.reportConfirmed && state.coupler && !state.coolingRestored && validPipeNumber(state.coolingFaultRow);
    case SCAN_ACTIONS.A: return state.coolingRestored && !state.scannedA && !state.passageSafe;
    case SCAN_ACTIONS.B: return state.coolingRestored && !state.scannedB && !state.passageSafe;
    case 'request_unlock': return canUnlock(state);
    default: return canControlAirlock(state.airlock, action);
  }
}

export function validPipeNumber(value) {
  return Number.isInteger(value) && value >= 1 && value <= GRID_SIZE;
}

export function currentObjective(state) {
  if (state.escaped) return {label: '撤离完成'};
  if (state.unlocked) return {label: phrase('从 {route} 通道撤离', {route: state.route}), target: 'lane'};
  if (state.airlock?.authorized) return {label: '到撤离区操作缓冲舱', target: 'exit'};
  if (state.passageSafe) return {label: '提交实测结果给 ECHO', target: 'echo'};
  if (state.coolingRestored && !state.scannedA && !state.scannedB) return {label: '请 ECHO 扫描通道', target: 'echo'};
  if (state.coolingRestored) return {label: '到撤离区核验通道', target: 'exit'};
  if (state.coupler) return {label: '在维修间接通备用冷却', target: 'cooling'};
  if (state.reportConfirmed) return {label: '到维修间取耦合器', target: 'locker'};
  if (state.password) return {label: '查阅事故报告', target: 'terminal'};
  if (!state.card) return {label: '拾取工作证', target: 'card'};
  if (!state.journal) return {label: '阅读研究日志', target: 'journal'};
  if (!state.rack) return {label: '到档案室读取存档', target: 'rack'};
  if (!state.archiveRecovered) return {label: '请 ECHO 恢复存档', target: 'echo'};
  if (!state.identity) return {label: '到控制室刷卡', target: 'terminal'};
  return {label: '推导终端密码', target: 'terminal'};
}
