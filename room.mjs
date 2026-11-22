export const WIDTH = 480;
export const HEIGHT = 264;
export const SPAWN = {x: 242, y: 212};
export const EXIT = {left: 370, right: 430, threshold: 58};
export const PASSAGE_LANES = {
  A: {left: 374, right: 397, center: 385},
  B: {left: 403, right: 426, center: 414}
};

export const OBJECTS = {
  card: {x: 108, y: 153, anchor: 113, label: '拾取工作证'},
  journal: {x: 153, y: 153, anchor: 112, label: '阅读研究日志'},
  rack: {x: 87, y: 77, anchor: 29, label: '读取机柜存档'},
  locker: {x: 57, y: 190, anchor: 164, label: '检查维修柜'},
  terminal: {x: 248, y: 120, anchor: 75, label: '操作安全终端'},
  cooling: {x: 365, y: 193, anchor: 141, label: '检修冷却回路'},
  exit: {x: 400, y: 74, anchor: 40, label: '检查出口检测台'}
};

const furniture = [
  {left: 64, right: 180, top: 110, bottom: 149},
  {left: 224, right: 272, top: 83, bottom: 117},
  {left: 330, right: 399, top: 148, bottom: 188},
  {left: 23, right: 56, top: 168, bottom: 213}
];

function clearPath(x, y, route) {
  const lane = PASSAGE_LANES[route];
  const inDoorway = lane && x >= lane.left && x <= lane.right;
  if (x < 23 || x > 456 || y > 244 || y < (inDoorway ? EXIT.threshold - 4 : 72)) return false;
  return !furniture.some(box => x + 5 > box.left && x - 5 < box.right && y > box.top && y < box.bottom);
}

export function move(player, dx, dy, route) {
  const {x, y} = player;
  if (clearPath(x + dx, y, route)) player.x += dx;
  if (clearPath(player.x, y + dy, route)) player.y += dy;
  return player.x !== x || player.y !== y;
}

export function nearbyObject(player, state) {
  let nearest;
  let best = 28;
  for (const [key, object] of Object.entries(OBJECTS)) {
    if ((key === 'card' && state.card) || (key === 'exit' && state.unlocked)) continue;
    const distance = Math.hypot(player.x - object.x, player.y - object.y);
    if (distance < best) {
      best = distance;
      nearest = key;
    }
  }
  return nearest;
}
