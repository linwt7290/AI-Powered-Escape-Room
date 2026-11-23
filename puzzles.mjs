import {DEFAULT_LOCALE, phrase, translate} from './i18n.mjs';

export const EXPERIMENTS = [
  {id: 'cooling', label: '冷却自检'},
  {id: 'calibration', label: '样本校准'},
  {id: 'pressure', label: '压力测试'},
  {id: 'archive', label: '保存记录'}
];

export const LOG_CLUE = '冷却自检完成后，下一项是样本校准。保存记录只能在压力测试完成后执行。';
export const RACK_CLUE = '时序核对结果：样本校准早于压力测试。';
export const FLOW_RESULT = '备用冷却已接管，试压流量稳定。';
export const PRESSURE_LIMIT = 4;
export const PARTICLE_LIMIT = 2;

export const INCIDENTS = {
  pressure: {
    cause: '主冷却回路压力异常',
    aliases: /(?:主冷却|主回路).{0,12}(?:压力|压强).{0,6}(?:异常|超限|过高|过低|失常)/,
    englishAliases: /(?:abnormal|high|low|irregular) pressure.{0,30}(?:primary|main) cooling|(?:primary|main) cooling.{0,30}(?:pressure.{0,12}(?:abnormal|high|low|fault|out of range)|(?:abnormal|high|low|irregular) pressure)/i,
    failedReading: {pressure: 6}
  },
  pump: {
    cause: '主冷却循环泵停转',
    aliases: /(?:循环泵|主泵|主冷却泵).{0,8}(?:停转|停机|失效|故障|卡住)/,
    englishAliases: /(?:(?:primary|main) cooling.{0,15}pump|circulation pump).{0,15}(?:stopped|failed|stalled)/i,
    failedReading: {particles: 3}
  },
  interlock: {
    cause: '主冷却联锁信号丢失',
    aliases: /(?:冷却.{0,6})?联锁(?:信号|通信|通讯)?.{0,5}(?:丢失|中断|失联|故障)/,
    englishAliases: /(?:interlock signal.{0,12}(?:lost|failed|missing)|lost.{0,16}interlock signal)/i,
    failedReading: {interlock: false}
  }
};

export function incidentReport(id, locale = DEFAULT_LOCALE) {
  return translate(locale, phrase('{cause}，触发紧急封锁。备用冷却因耦合器被拆下而离线。请到维修柜取得耦合器，接通备用泵与散热器并试压。随后请 ECHO 扫描通道，在出口检测台核对读数。', {cause: INCIDENTS[id].cause}));
}

const NORTH = 1;
const EAST = 2;
const SOUTH = 4;
const WEST = 8;
const SIDES = [NORTH, EAST, SOUTH, WEST];
export const GRID_SIZE = 4;

// 源端在第一行左侧，出口在第四行右侧。
const PIPE_LAYOUT = [
  WEST | EAST, WEST | SOUTH, EAST | SOUTH, WEST | SOUTH,
  EAST | SOUTH, NORTH | WEST, NORTH | SOUTH, WEST | EAST,
  NORTH | EAST, WEST | SOUTH, NORTH | EAST, NORTH | WEST,
  NORTH | SOUTH, NORTH | EAST, WEST | EAST, WEST | EAST
];

export function rotatePipe(ports) {
  return ((ports << 1) | (ports >> 3)) & 15;
}

export function traceCircuit(tiles) {
  const energized = [];
  let x = 0;
  let y = 0;
  let inlet = WEST;
  while (x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE) {
    const index = y * GRID_SIZE + x;
    if (!(tiles[index] & inlet)) return {connected: false, energized, leak: index};
    energized.push(index);
    const outlet = tiles[index] ^ inlet;
    if (x === GRID_SIZE - 1 && y === GRID_SIZE - 1 && outlet === EAST) {
      return {connected: true, energized, leak: null};
    }
    const direction = SIDES.indexOf(outlet);
    x += [0, 1, 0, -1][direction];
    y += [-1, 0, 1, 0][direction];
    inlet = SIDES[(direction + 2) % SIDES.length];
  }
  return {connected: false, energized, leak: energized.at(-1) ?? 0};
}

export function safePassage({pressure, particles, interlock}) {
  return pressure <= PRESSURE_LIMIT && particles <= PARTICLE_LIMIT && interlock;
}

export function alignNextPipe(tiles) {
  // 沿既定线路修复第一处偏差，保留玩家对其他管段的调整。
  const path = traceCircuit(PIPE_LAYOUT).energized;
  const index = path.find(tile => tiles[tile] !== PIPE_LAYOUT[tile]);
  if (index === undefined) return null;
  tiles[index] = PIPE_LAYOUT[index];
  return index;
}

export function createCase(random = Math.random) {
  const available = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const digits = EXPERIMENTS.map(() => available.splice(Math.floor(random() * available.length), 1)[0]);
  const tiles = PIPE_LAYOUT.map(ports => {
    const turns = Math.floor(random() * SIDES.length);
    for (let turn = 0; turn < turns; turn++) ports = rotatePipe(ports);
    return ports;
  });
  if (traceCircuit(tiles).connected) tiles[0] = rotatePipe(tiles[0]);

  const kinds = Object.keys(INCIDENTS);
  const kind = kinds[Math.floor(random() * kinds.length)];
  const safe = {pressure: 3, particles: 1, interlock: true};
  const unsafe = {...safe, ...INCIDENTS[kind].failedReading};
  const routes = random() < .5 ? {A: safe, B: unsafe} : {A: unsafe, B: safe};
  const preferredScan = random() < .5 ? 'A' : 'B';
  return {digits, tiles, routes, kind, preferredScan};
}
