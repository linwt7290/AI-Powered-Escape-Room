import {EXIT, HEIGHT, PASSAGE_LANES, WIDTH} from './room.mjs';

const FRONT = [
  '....HHHHHH......', '..HHhhhhhhHH....', '..HhhhhhHHhH....', '.HHhHHHHHhhHH...',
  '.HHhssssshHHH...', '.HhssSSssshHH...', '..Hs.sS.sSHH....', '..HsssSsssHH....',
  '...sssssssH.....', '....SSSSS.......', '...ooOSOoo......', '..oWWOOWWWo.....',
  '..oWWOWWWWo.....', '..oWWOOWWWoA....', '..oWWOWWWWoA....', '..oWWOOWWWoo....',
  '..sWoOWWWOs.....', '..sWoOOWOOs.....', '...oOooOoO......'
];
const SIDE = [
  '.....HHHHHH.....', '....HhhhHhHH....', '...HhhhhhhhHH...', '...HhHhhhhhHH...',
  '...HHhsssHHHH...', '...HHssssssHH...', '...HHsss.SsH....', '...HHsssssss....',
  '....HssssSS.....', '.....SSSSS......', '....ooOOo.......', '...oWWWWOo......',
  '...oWWWWOo......', '...oWAWWOo......', '...oWAWWOo......', '...oWOWWOo......',
  '...oWOWWOo......', '....sOWWOO......', '....oOOOoo......'
];
const BACK = [
  '....HHHHHH......', '..HHhhhhhhHH....', '..HhhhhhhhhH....', '.HHhhhHHhhhHH...',
  '.HHhhHHHHhhHH...', '.HHhHHHHHHhHH...', '..HHHHHHHHHH....', '..HHHHHHHHHH....',
  '...HHHHHHHH.....', '....HSSSSH......', '...ooOOOoo......', '..oWWWWWWWo.....',
  '..oWWWWWWWo.....', '.AoWWWWWWWo.....', '.AoWWOOOWWo.....', '.ooWWWWWWWoo....',
  '..sOWWWWWOs.....', '..sOOWWWOOs.....', '...oOoooOO......'
];
const CLOTH = {
  H: '#141e2d', h: '#3a4656', s: '#eab899', S: '#c7836b', o: '#273944',
  O: '#a6bbc6', W: '#f4efe0', A: '#f4a65d'
};

function rect(ctx, color, x, y, width, height) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, width, height);
}

function panel(ctx, x, y, width, height, fill = '#233640', edge = '#46606a') {
  rect(ctx, '#0b151e', x + 2, y + 3, width, height);
  rect(ctx, edge, x, y, width, height);
  rect(ctx, fill, x + 1, y + 1, width - 2, height - 3);
}

function lightTexture(paint) {
  const texture = document.createElement('canvas');
  texture.width = WIDTH / 4;
  texture.height = HEIGHT / 4;
  const ctx = texture.getContext('2d');
  ctx.scale(1 / 4, 1 / 4);
  paint(ctx);
  return texture;
}

function glow(ctx, x, y, radiusX, radiusY, color, strength) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(radiusX, radiusY);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0, 'rgba(' + color + ',' + strength + ')');
  gradient.addColorStop(.45, 'rgba(' + color + ',' + strength * .47 + ')');
  gradient.addColorStop(1, 'rgba(' + color + ',0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
}

function paintScreen(ctx, x, y, status, time) {
  const ink = status === 'granted' ? '#8ef1a5' : status === 'busy' ? '#ffcb7f' : '#81ebd6';
  rect(ctx, '#11242d', x, y, 24, 24);
  panel(ctx, x + 2, y + 3, 20, 16, '#0c272e', '#52707b');
  rect(ctx, '#1c4246', x + 4, y + 5, 16, 2);
  rect(ctx, '#4b616b', x + 9, y + 20, 6, 2);
  rect(ctx, '#4b616b', x + 6, y + 22, 12, 1);
  const parts = status === 'granted'
    ? [[7, 10, 2, 2], [9, 12, 2, 2], [11, 10, 2, 2], [13, 8, 2, 2], [15, 6, 2, 2]]
    : status === 'busy'
      ? [[7, 10, 4, 1], [13, 10, 4, 1], [11, 13, 2, 1]]
      : [[7, 9, 2, 3], [15, 9, 2, 3], [10, 13, 4, 1]];
  for (const [dx, dy, width, height] of parts) rect(ctx, ink, x + dx, y + dy, width, height);
  rect(ctx, ink, x + 19, y + 16, 1, 1);
  if (status === 'busy') rect(ctx, ink, x + 5 + Math.floor(time / 165) % 6 * 2, y + 15, 2, 1);
}

export function drawEcho(canvas, status, time = 0) {
  paintScreen(canvas.getContext('2d'), 0, 0, status, time);
}

function paintRoom(ctx) {
  rect(ctx, '#101a24', 0, 0, WIDTH, HEIGHT);
  rect(ctx, '#233640', 14, 65, 452, 185);
  // 地砖、磨损与嵌入地面的灯带。
  let seed = 109;
  const random = max => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % max;
  };
  const floor = ['#2a3d46', '#293b45', '#283a43', '#2c4049', '#253842'];
  for (let y = 67; y < 247; y += 16) {
    for (let x = 16; x < 464; x += 16) {
      const height = Math.min(16, 247 - y);
      rect(ctx, floor[random(floor.length)], x, y, 16, height);
      rect(ctx, '#354953', x, y, 15, 1);
      rect(ctx, '#1e3039', x + 15, y + 1, 1, height - 1);
      rect(ctx, '#20313a', x, y + height - 1, 16, 1);
      rect(ctx, '#3a4a50', x + 3 + random(8), y + 2 + random(height - 3), 2 + random(3), 1);
    }
  }
  rect(ctx, '#39525a', 19, 232, 440, 1);
  rect(ctx, '#1a2d37', 19, 233, 440, 5);
  for (let x = 25; x < 456; x += 12) rect(ctx, x % 48 === 25 ? '#577d81' : '#324b54', x, 235, 6, 1);
  // 磨损的导向线把三个操作区连起来。
  rect(ctx, '#384b55', 109, 164, 284, 2);
  rect(ctx, '#384b55', 393, 120, 2, 46);
  rect(ctx, '#384b55', 247, 124, 2, 40);
  for (let x = 118; x <= 380; x += 24) rect(ctx, '#52666b', x, 164, 3, 1);
  for (const x of [217, 241, 265]) {
    rect(ctx, '#435963', x, 223, 13, 1);
    rect(ctx, '#334852', x + 1, 224, 11, 1);
  }
  rect(ctx, '#344c58', 14, 248, 452, 5);
  rect(ctx, '#172932', 14, 253, 452, 6);
  rect(ctx, '#0b1721', 0, 259, 480, 5);

  // 北墙的隔板、管线及出入口。
  rect(ctx, '#182a36', 12, 0, 456, 66);
  rect(ctx, '#344d58', 12, 4, 456, 3);
  rect(ctx, '#101d28', 12, 8, 456, 6);
  for (let x = 19; x < 462; x += 37) {
    rect(ctx, '#223845', x, 15, 34, 44);
    rect(ctx, '#2e4551', x, 15, 34, 1);
    rect(ctx, '#142630', x + 33, 16, 1, 43);
    rect(ctx, '#59717a', x + 2, 19, 1, 1);
    rect(ctx, '#536973', x + 30, 55, 1, 1);
  }
  rect(ctx, '#44616c', 14, 59, 452, 2);
  rect(ctx, '#121c26', 14, 61, 452, 7);
  rect(ctx, '#21343e', 14, 68, 452, 2);
  rect(ctx, '#111e29', 0, 0, 12, 260);
  rect(ctx, '#111e29', 468, 0, 12, 260);
  rect(ctx, '#49616d', 12, 3, 3, 249);
  rect(ctx, '#49616d', 465, 3, 3, 249);
  rect(ctx, '#243a46', 16, 5, 3, 242);
  rect(ctx, '#253c47', 461, 5, 3, 242);
  rect(ctx, '#131e28', 19, 22, 300, 7);
  rect(ctx, '#455761', 20, 23, 297, 3);
  for (const x of [45, 84, 154, 192, 281, 306]) rect(ctx, '#6d7d80', x, 22, 3, 6);

  for (const [x, hue] of [[29, '#77c4c0'], [68, '#58c1c9'], [107, '#7fbd9c']]) {
    panel(ctx, x, 31, 34, 44, '#243943');
    rect(ctx, '#111f2a', x + 4, 37, 26, 30);
    for (let row = 0; row < 5; row++) {
      rect(ctx, '#3a5964', x + 6, 39 + row * 5, 22, 2);
      rect(ctx, row % 3 ? hue : '#dca762', x + 23, 39 + row * 5, 2, 1);
    }
    rect(ctx, '#50646c', x + 11, 70, 12, 2);
  }
  panel(ctx, 164, 34, 46, 23, '#192e39');
  rect(ctx, '#42666c', 170, 39, 33, 2);
  rect(ctx, '#28454e', 170, 45, 33, 2);
  rect(ctx, '#28454e', 170, 50, 20, 2);
  panel(ctx, 219, 33, 59, 25, '#14282e', '#3e615f');
  rect(ctx, '#28494b', 222, 36, 53, 17);
  rect(ctx, '#142c32', 224, 38, 49, 13);
  rect(ctx, '#599995', 226, 40, 2, 9);
  const sign = ['111.111.101.111', '100.100.101.101', '110.100.111.101', '100.100.101.101', '111.111.101.111'];
  for (const [row, squares] of sign.entries()) {
    for (let column = 0; column < squares.length; column++) {
      if (squares[column] === '1') rect(ctx, '#9bc9bf', 235 + column * 2, 40 + row * 2, 2, 2);
    }
  }
  rect(ctx, '#25464c', 244, 56, 7, 17);
  rect(ctx, '#142630', 246, 56, 3, 17);
  rect(ctx, '#3d555d', 292, 35, 19, 22);
  rect(ctx, '#243640', 294, 37, 15, 18);
  rect(ctx, '#e3ae62', 298, 41, 7, 1);
  rect(ctx, '#a67d4b', 300, 45, 3, 6);

  // 地面疏散线和门框。门扇独立绘制。
  rect(ctx, '#202d36', 355, 69, 89, 54);
  rect(ctx, '#36474d', 359, 72, 81, 44);
  rect(ctx, '#76704c', 359, 72, 2, 44);
  rect(ctx, '#76704c', 438, 72, 2, 44);
  for (let x = 361; x < 437; x += 8) {
    rect(ctx, '#a48654', x, 111, 4, 5);
    rect(ctx, '#756343', x + 2, 113, 4, 3);
  }
  rect(ctx, '#314453', 359, 20, 82, 52);
  rect(ctx, '#647780', 364, 22, 72, 3);
  rect(ctx, '#536671', 363, 25, 6, 43);
  rect(ctx, '#536671', 431, 25, 6, 43);
  rect(ctx, '#0d1823', EXIT.left, 27, 60, 45);
  for (const x of [365, 434]) {
    rect(ctx, '#99a4a2', x, 29, 1, 3);
    rect(ctx, '#99a4a2', x, 62, 1, 3);
  }
  panel(ctx, 442, 50, 15, 17, '#213a45', '#506d72');
  rect(ctx, '#0e252e', 444, 52, 11, 8);
  rect(ctx, '#577076', 446, 55, 3, 2);
  rect(ctx, '#577076', 451, 55, 3, 2);

  // 办公桌、证件位置、研究日志与暖色台灯。
  rect(ctx, '#17272e', 61, 146, 125, 9);
  panel(ctx, 65, 112, 115, 38, '#414f4e', '#777c66');
  rect(ctx, '#746d54', 67, 113, 111, 23);
  rect(ctx, '#877e5d', 68, 114, 109, 2);
  rect(ctx, '#615d4a', 68, 133, 110, 4);
  rect(ctx, '#283c46', 68, 138, 108, 9);
  rect(ctx, '#627173', 75, 139, 29, 6);
  rect(ctx, '#273a43', 77, 140, 25, 4);
  rect(ctx, '#8c9a91', 85, 141, 10, 1);
  rect(ctx, '#56696d', 138, 139, 32, 7);
  rect(ctx, '#344a52', 140, 140, 28, 5);
  rect(ctx, '#9da397', 147, 141, 12, 1);
  rect(ctx, '#564b3a', 96, 119, 26, 12);
  rect(ctx, '#b28c55', 97, 118, 23, 11);
  rect(ctx, '#cca46a', 98, 117, 8, 2);
  rect(ctx, '#404d48', 142, 118, 24, 15);
  rect(ctx, '#bba781', 144, 117, 18, 13);
  rect(ctx, '#eed7a4', 146, 117, 13, 11);
  rect(ctx, '#6e7469', 150, 115, 6, 2);
  for (let y = 120; y < 128; y += 2) rect(ctx, '#9d9174', 147, y, 8, 1);
  rect(ctx, '#493f33', 74, 129, 13, 3);
  rect(ctx, '#334753', 77, 113, 3, 17);
  rect(ctx, '#536772', 78, 107, 11, 3);
  rect(ctx, '#c49f67', 86, 106, 7, 3);
  rect(ctx, '#fbe2a6', 86, 109, 9, 2);
  rect(ctx, '#f3c27538', 83, 112, 17, 5);
  rect(ctx, '#f3c27522', 81, 117, 25, 10);

  // 安全终端及冷却设备。
  rect(ctx, '#1b2b34', 219, 114, 59, 9);
  panel(ctx, 225, 83, 47, 35, '#425865', '#759094');
  rect(ctx, '#182b35', 229, 85, 39, 25);
  rect(ctx, '#457077', 231, 87, 35, 20);
  rect(ctx, '#11343f', 233, 88, 31, 17);
  rect(ctx, '#255a62', 233, 88, 31, 2);
  rect(ctx, '#212f37', 229, 112, 40, 4);
  for (let x = 235; x < 256; x += 4) rect(ctx, '#6e8b88', x, 113, 2, 1);
  rect(ctx, '#e7a968', 260, 113, 5, 1);
  rect(ctx, '#3c6470', 326, 142, 75, 50);
  rect(ctx, '#162730', 328, 145, 74, 49);
  panel(ctx, 330, 145, 70, 45, '#344c55', '#6a8383');
  rect(ctx, '#1b3442', 333, 151, 64, 23);
  rect(ctx, '#568487', 335, 152, 60, 19);
  rect(ctx, '#244d59', 338, 154, 55, 15);
  rect(ctx, '#326d73', 343, 156, 45, 10);
  rect(ctx, '#538b8c', 348, 158, 38, 5);
  rect(ctx, '#74aeaa', 351, 158, 30, 2);
  for (const x of [337, 385]) {
    rect(ctx, '#465e66', x, 147, 8, 28);
    rect(ctx, '#839a96', x + 1, 148, 2, 25);
  }
  rect(ctx, '#20343e', 334, 176, 62, 10);
  for (let x = 339; x <= 383; x += 4) rect(ctx, '#526b70', x, 179, 2, 4);
  rect(ctx, '#81c9b0', 390, 178, 3, 2);
  rect(ctx, '#384b52', 25, 168, 30, 46);
  for (const y of [168, 191]) {
    panel(ctx, 24, y, 32, 20, '#42545a', '#667879');
    rect(ctx, '#1c313a', 27, y + 5, 26, 11);
    rect(ctx, '#6e8180', 28, y + 7, 7, 2);
    rect(ctx, '#5d757c', 43, y + 12, 7, 2);
  }
  for (const [x, y] of [[23, 94], [194, 173], [420, 187]]) {
    rect(ctx, '#23343d', x, y, 25, 10);
    rect(ctx, '#58696b', x, y, 25, 1);
    for (let bar = x + 2; bar < x + 24; bar += 3) rect(ctx, '#142630', bar, y + 2, 1, 6);
  }
}

function drawDoor(ctx, opening, route) {
  const unlocked = Boolean(route);
  const x = EXIT.left;
  const sliding = Math.max(0, (opening - .16) / .84);
  const width = Math.round(30 * (1 - sliding * sliding * (3 - 2 * sliding)));
  rect(ctx, '#102b2f', x + 1, 28, 58, 41);
  rect(ctx, '#194341', x + 5, 32, 50, 37);
  rect(ctx, '#2d6256', x + 11, 39, 38, 30);
  for (const [inset, y] of [[9, 45], [7, 53], [5, 62]]) {
    rect(ctx, '#498173', x + inset, y, 60 - inset * 2, 1);
  }
  rect(ctx, '#83dbb6', x + 12, 43, 1, 21);
  rect(ctx, '#83dbb6', x + 47, 43, 1, 21);
  for (const dx of [0, 60 - width]) {
    if (!width) continue;
    rect(ctx, '#495762', x + dx, 30, width, 38);
    rect(ctx, '#64737a', x + dx, 31, width, 2);
    rect(ctx, '#364751', x + dx, 59, width, 7);
    if (width > 8) rect(ctx, unlocked ? '#274c4a' : '#502a32', x + dx + 4, 42, width - 7, 5);
    if (width > 11) rect(ctx, unlocked ? '#7bd8b8' : '#ab5b60', x + dx + 6, 43, width - 11, 2);
  }
  if (width === 30) rect(ctx, '#242831', x + 29, 30, 2, 38);
  if (unlocked && sliding > .8) {
    const blocked = PASSAGE_LANES[route === 'A' ? 'B' : 'A'];
    rect(ctx, '#2a343c', blocked.left, 64, blocked.right - blocked.left, 7);
    rect(ctx, '#765d53', blocked.left, 64, blocked.right - blocked.left, 2);
    rect(ctx, '#cb8876', blocked.center - 3, 67, 7, 2);
    rect(ctx, '#34474c', 398, 35, 4, 36);
  }
  const lamp = unlocked ? '#9cf4bc' : '#fa776e';
  rect(ctx, unlocked ? '#67e0a122' : '#f4796d24', 384, 10, 32, 12);
  rect(ctx, unlocked ? '#305747' : '#693d42', 389, 12, 22, 8);
  rect(ctx, lamp, 394, 14, 12, 3);
  rect(ctx, '#253641', x + 5, 69, 50, 2);
  rect(ctx, '#6a6652', 399, 73, 2, 37);
  for (const [name, lane] of Object.entries(PASSAGE_LANES)) {
    const active = name === route;
    rect(ctx, active ? '#346052' : '#34434a', lane.left, 72, lane.right - lane.left, 36);
    for (const [index, y] of [84, 94, 104].entries()) {
      const color = active && opening >= .24 + index * .21 ? '#a4ecbd' : '#777653';
      rect(ctx, color, lane.center - 2, y, 4, 2);
      rect(ctx, color, lane.center - 4, y + 2, 8, 1);
    }
  }
}

function drawPlayer(ctx, player, time) {
  const step = player.moving ? Math.floor(time / 110) % 4 : 0;
  const x = Math.round(player.x) - 7;
  const y = Math.round(player.y) - 24 - (step % 2);
  const pattern = {up: BACK, down: FRONT, left: SIDE, right: SIDE}[player.facing];
  rect(ctx, '#1b2a32', x + 2, Math.round(player.y) - 1, 12, 3);
  rect(ctx, '#1b2a32', x + 4, Math.round(player.y) - 2, 8, 5);
  pattern.forEach((row, dy) => {
    Array.from(row).forEach((pixel, dx) => {
      if (CLOTH[pixel]) rect(ctx, CLOTH[pixel], x + (player.facing === 'left' ? 15 - dx : dx), y + dy, 1, 1);
    });
  });
  for (const [index, leg] of [4, 8].entries()) {
    const stride = step % 2 && index === (step - 1) / 2 ? 1 : 0;
    rect(ctx, '#466277', x + leg, y + 19, 3, 4 + stride);
    rect(ctx, '#142330', x + leg, y + 22 + stride, 4, 2);
  }
  if (time > 0 && player.pickupUntil > time) {
    rect(ctx, '#ead0a2', x + 11, y + 13, 6, 3);
    rect(ctx, '#ffe5aa', x + 16, y + 12, 3, 2);
  }
}

export function createPainter(canvas) {
  const ctx = canvas.getContext('2d', {alpha: false});
  ctx.imageSmoothingEnabled = false;
  const backdrop = document.createElement('canvas');
  backdrop.width = WIDTH;
  backdrop.height = HEIGHT;
  paintRoom(backdrop.getContext('2d'));
  const ambient = lightTexture(lighting => {
    const shade = lighting.createRadialGradient(235, 129, 42, 235, 129, 251);
    shade.addColorStop(0, '#0a101600');
    shade.addColorStop(.66, '#09122132');
    shade.addColorStop(1, '#070d175d');
    lighting.fillStyle = shade;
    lighting.fillRect(0, 0, WIDTH, HEIGHT);
  });
  const roomLights = lightTexture(lighting => {
    glow(lighting, 103, 124, 83, 52, '238,165,83', .34);
    glow(lighting, 151, 127, 44, 29, '253,202,115', .19);
    glow(lighting, 247, 95, 73, 55, '39,202,199', .31);
    glow(lighting, 362, 163, 67, 45, '35,159,174', .27);
    glow(lighting, 87, 48, 76, 38, '44,125,156', .19);
  });
  const alarmLight = lightTexture(lighting => {
    glow(lighting, 399, 21, 57, 41, '246,87,76', .48);
    glow(lighting, 400, 75, 47, 54, '211,68,65', .32);
  });
  const exitLights = Object.fromEntries(Object.entries(PASSAGE_LANES).map(([name, lane]) => [name, lightTexture(lighting => {
    glow(lighting, lane.center, 42, 38, 52, '71,233,157', .4);
    glow(lighting, lane.center, 92, 34, 55, '78,234,163', .43);
  })]));

  return (state, player, opening, pending, time) => {
    ctx.drawImage(backdrop, 0, 0);
    drawDoor(ctx, opening, state.unlocked ? state.route : null);
    if (!state.card) {
      rect(ctx, '#7e634c', 104, 123, 10, 7);
      rect(ctx, '#f1dca9', 104, 122, 10, 6);
      rect(ctx, '#716e64', 105, 123, 3, 3);
      rect(ctx, '#ad905e', 109, 124, 4, 1);
    }
    ctx.drawImage(ambient, 0, 0, WIDTH, HEIGHT);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(roomLights, 0, 0, WIDTH, HEIGHT);
    ctx.globalAlpha = state.unlocked ? .42 + opening * .58 : .89 + .11 * Math.cos(time / 530);
    ctx.drawImage(state.unlocked ? exitLights[state.route] : alarmLight, 0, 0, WIDTH, HEIGHT);
    ctx.restore();
    if (state.rack) {
      rect(ctx, state.archiveRecovered ? '#9fedb9' : '#e0ab72', 89, 41, 3, 2);
    }
    const serviceLight = state.coupler ? '#4a6669' : state.reportConfirmed ? '#f5ba79' : '#8c6456';
    rect(ctx, serviceLight, 31, 197, 3, 2);
    const sensorLight = state.passageSafe ? '#99e9b3' : '#8ae1d1';
    rect(ctx, state.scannedA ? sensorLight : '#7e746b', 446, 55, 3, 2);
    rect(ctx, state.scannedB ? sensorLight : '#7e746b', 451, 55, 3, 2);
    if (state.coolingRestored) {
      rect(ctx, '#8ae1d1', 349, 159, 35, 1);
      rect(ctx, '#a1f3d7', 390, 178, 3, 2);
    }
    paintScreen(ctx, 236, 84, state.unlocked ? 'granted' : pending ? 'busy' : 'idle', time);
    const coolingPulse = 348 + Math.floor(time / 115) % 34;
    rect(ctx, '#84d6ca', coolingPulse, 159, 3, 1);
    drawPlayer(ctx, player, time);
  };
}
