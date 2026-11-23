export const WIDTH = 480;
export const HEIGHT = 264;
export const SPAWN = {room: 'research', x: 242, y: 212};
export const EXIT = {left: 370, right: 430, threshold: 58};
export const PASSAGE_LANES = {
  A: {left: 374, right: 397, center: 385},
  B: {left: 403, right: 426, center: 414}
};

export const ROOMS = {
  research: {name: '研究室', position: [1, 2], doors: {east: 'control', south: 'duty'}, furniture: [
    {left: 64, right: 180, top: 110, bottom: 149},
    {left: 269, right: 383, top: 90, bottom: 123}
  ]},
  control: {name: '控制室', position: [2, 2], doors: {west: 'research', north: 'archive', east: 'maintenance', south: 'service'}, furniture: [
    {left: 309, right: 357, top: 83, bottom: 117},
    {left: 62, right: 149, top: 85, bottom: 114}
  ]},
  archive: {name: '档案室', position: [2, 1], doors: {south: 'control', east: 'exit'}, furniture: [
    {left: 28, right: 142, top: 67, bottom: 75},
    {left: 304, right: 394, top: 77, bottom: 127},
    {left: 309, right: 393, top: 188, bottom: 233}
  ]},
  maintenance: {name: '维修间', position: [3, 2], doors: {west: 'control', north: 'exit'}, furniture: [
    {left: 93, right: 126, top: 168, bottom: 213},
    {left: 330, right: 399, top: 100, bottom: 140},
    {left: 94, right: 185, top: 89, bottom: 121}
  ]},
  exit: {name: '撤离区', position: [3, 1], doors: {west: 'archive', south: 'maintenance'}, furniture: [
    {left: 171, right: 267, top: 77, bottom: 116}
  ]},
  duty: {name: '值班室', position: [1, 3], doors: {north: 'research', east: 'service'}, furniture: [
    {left: 82, right: 173, top: 102, bottom: 138},
    {left: 313, right: 376, top: 198, bottom: 232}
  ]},
  service: {name: '设备走廊', position: [2, 3], doors: {west: 'duty', north: 'control'}, furniture: [
    {left: 302, right: 412, top: 96, bottom: 130},
    {left: 329, right: 395, top: 193, bottom: 226}
  ]}
};

export const DOORS = {
  west: {axis: 'x', boundary: 23, sign: -1, center: 164, arrival: 440, label: [63, 137]},
  east: {axis: 'x', boundary: 456, sign: 1, center: 164, arrival: 39, label: [417, 137]},
  north: {axis: 'y', boundary: 72, sign: -1, center: 240, arrival: 228, label: [240, 47]},
  south: {axis: 'y', boundary: 244, sign: 1, center: 240, arrival: 88, label: [240, 242]}
};
export const DOOR_HALF_WIDTH = 26;

export const ROOM_PROPS = {
  microscope: {room: 'research', x: 326, y: 128, anchor: 88, frame: [314, 99, 25, 18], label: '观察显微镜', title: '显微镜'},
  intercom: {room: 'control', x: 106, y: 119, anchor: 83, frame: [95, 91, 22, 17], label: '试用广播台', title: '广播台'},
  photo: {room: 'archive', x: 349, y: 131, anchor: 74, frame: [335, 101, 29, 20], label: '查看合影', title: '研究组合影'},
  coffee: {room: 'duty', x: 123, y: 143, anchor: 100, frame: [111, 113, 27, 20], label: '使用咖啡机', title: '咖啡机'},
  lights: {room: 'service', x: 358, y: 139, anchor: 93, frame: [345, 111, 26, 16], label: '操作走廊灯', title: '照明面板'}
};
export const PROP_BY_ROOM = Object.fromEntries(Object.entries(ROOM_PROPS).map(([id, prop]) => [prop.room, id]));

export const OBJECTS = {
  card: {room: 'research', x: 108, y: 153, anchor: 113, frame: [103, 121, 13, 9], label: '拾取工作证'},
  journal: {room: 'research', x: 153, y: 153, anchor: 112, frame: [143, 116, 20, 16], label: '阅读研究日志'},
  rack: {room: 'archive', x: 87, y: 77, anchor: 29, frame: [67, 30, 36, 46], label: '读取机柜存档'},
  locker: {room: 'maintenance', x: 127, y: 190, anchor: 164, frame: [93, 167, 34, 47], label: '检查维修柜'},
  terminal: {room: 'control', x: 333, y: 120, anchor: 75, frame: [309, 82, 49, 37], label: '操作安全终端'},
  cooling: {room: 'maintenance', x: 365, y: 145, anchor: 93, frame: [329, 96, 72, 47], label: '检修冷却回路'},
  exit: {room: 'exit', x: 400, y: 74, anchor: 40, frame: [369, 27, 62, 44], label: '检查出口检测台'},
  ...ROOM_PROPS
};

export const OBJECT_KEYS_BY_ROOM = Object.fromEntries(Object.keys(ROOMS).map(room => [room,
  Object.keys(OBJECTS).filter(key => OBJECTS[key].room === room)
]));

export function canInspectObject(key, state) {
  return !state.escaped && !(key === 'card' && state.card) && !(key === 'exit' && state.unlocked);
}

export function nextDoor(from, to) {
  if (from === to) return;
  const visited = new Set([from]);
  const queue = [{room: from, firstDoor: undefined}];
  for (const {room, firstDoor} of queue) {
    for (const [door, neighbor] of Object.entries(ROOMS[room].doors)) {
      if (visited.has(neighbor)) continue;
      const exit = firstDoor ?? door;
      if (neighbor === to) return exit;
      visited.add(neighbor);
      queue.push({room: neighbor, firstDoor: exit});
    }
  }
}

function clearPath(room, x, y, route) {
  const lane = room === 'exit' ? PASSAGE_LANES[route] : null;
  const inDoorway = lane && x >= lane.left && x <= lane.right;
  if (x < 23 || x > 456 || y > 244 || y < (inDoorway ? EXIT.threshold - 4 : 72)) return false;
  return !ROOMS[room].furniture.some(box => x + 5 > box.left && x - 5 < box.right && y > box.top && y < box.bottom);
}

export function move(player, dx, dy, route) {
  const {x, y} = player;
  for (const [side, destination] of Object.entries(ROOMS[player.room].doors)) {
    const {axis, boundary, sign, center, arrival} = DOORS[side];
    const next = axis === 'x' ? x + dx : y + dy;
    const transverse = axis === 'x' ? y : x;
    if ((next - boundary) * sign <= 0 || Math.abs(transverse - center) >= DOOR_HALF_WIDTH) continue;
    player.room = destination;
    player[axis] = arrival;
    return true;
  }
  if (clearPath(player.room, x + dx, y, route)) player.x += dx;
  if (clearPath(player.room, player.x, y + dy, route)) player.y += dy;
  return player.x !== x || player.y !== y;
}

export function nearbyObject(player, state) {
  let nearest;
  let best = 28;
  for (const key of OBJECT_KEYS_BY_ROOM[player.room] ?? []) {
    if (!canInspectObject(key, state)) continue;
    const object = OBJECTS[key];
    const distance = Math.hypot(player.x - object.x, player.y - object.y);
    if (distance < best) {
      best = distance;
      nearest = key;
    }
  }
  return nearest;
}
