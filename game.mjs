import {canEchoAct, initialState, SCAN_ACTIONS, SCAN_FIELDS} from './rules.mjs';
import {EXIT, HEIGHT, move, nearbyObject, OBJECTS, PASSAGE_LANES, SPAWN, WIDTH} from './room.mjs';
import {createPainter, drawEcho} from './pixel-art.mjs';
import {createCase, EXPERIMENTS, FLOW_RESULT, incidentReport, LOG_CLUE, RACK_CLUE} from './puzzles.mjs';
import {createDevices} from './devices.mjs';

const byId = id => document.getElementById(id);
const panels = [...document.querySelectorAll('dialog')];
const markers = Object.fromEntries(
  Array.from(document.querySelectorAll('[data-marker]'), element => [element.dataset.marker, element])
);
const progressBars = [...document.querySelectorAll('.progress-bars i')];
const roomAction = byId('roomAction');
const touchAction = byId('touchAction');
const code = byId('code');
const terminal = byId('terminalDialog');
const notebook = byId('journalDialog');
const chat = byId('echoDialog');
const evidenceButtons = [...document.querySelectorAll('[data-evidence]')];
const chatInput = byId('chatInput');
const conversation = byId('conversation');
const portrait = byId('echoPortrait');
const quickActions = [
  {label: '恢复机柜存档', text: '请恢复机柜存档。', actions: ['recover_archive']},
  {label: '校准一段管路', text: '请远程校准一段管路。', actions: ['align_pipe']},
  {label: '请 ECHO 选择扫描对象', text: '请选择一条待查通道进行扫描。', actions: Object.values(SCAN_ACTIONS)},
  {label: '扫描 A 通道', text: '请扫描 A 通道。', actions: [SCAN_ACTIONS.A]},
  {label: '扫描 B 通道', text: '请扫描 B 通道。', actions: [SCAN_ACTIONS.B]}
].map(({label, text, actions}) => {
  const button = document.createElement('button');
  button.className = 'button';
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', () => {
    chatInput.value = text;
    byId('chatForm').requestSubmit();
  });
  byId('echoActions').append(button);
  return {button, actions};
});
const paint = createPainter(byId('room'));
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const desktopPointer = matchMedia('(pointer: fine)');
const keys = new Map(Object.entries({
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right'
}));
const pressed = new Map();
const touch = new Map();
const openingMessage = '实验室已封锁。到办公桌找工作证和研究日志。';
const startNotice = '请刷工作证，并用两份实验记录推导密码。';
const modeLabels = {
  model: '模型已配置', demo: '本地演示', incomplete: '模型配置不完整', offline: '服务未连接'
};

let state = initialState();
let incident;
let player = {...SPAWN, facing: 'down', moving: false, pickupUntil: 0};
let history = [];
let pending;
let connection = '正在连接';
let nearest;
let evidenceSource;
let opening = 0;
let lastFrame = performance.now();

function pin(element, x, y) {
  element.style.left = 100 * x / WIDTH + '%';
  element.style.top = 100 * y / HEIGHT + '%';
}

for (const [name, marker] of Object.entries(markers)) {
  const location = name === 'desk' ? {x: 124, anchor: 106} : OBJECTS[name];
  pin(marker, location.x, location.anchor);
}

const devices = createDevices(() => state, setMessage, render);
byId('journalClue').textContent = LOG_CLUE;

function setMessage(message) {
  byId('message').textContent = message;
}

function setTerminalNotice(text, error = false) {
  const notice = byId('terminalNotice');
  notice.textContent = text;
  notice.dataset.error = String(error);
  setMessage(text);
}

function setChatStatus(text = '', error = false) {
  const status = byId('chatStatus');
  status.textContent = text;
  status.dataset.error = String(error);
  status.hidden = !text;
}

function renderComms() {
  byId('echoStatus').textContent = connection;
  chat.dataset.phase = state.unlocked ? 'granted' : pending ? 'busy' : 'idle';
  byId('send').disabled = Boolean(pending) || !chatInput.value.trim();
  chatInput.readOnly = Boolean(pending);
  for (const {button, actions} of quickActions) {
    button.hidden = !actions.some(action => canEchoAct(state, action));
    button.disabled = Boolean(pending);
  }
  byId('echoActions').hidden = quickActions.every(({button}) => button.hidden);
}

function renderTarget() {
  roomAction.hidden = !nearest;
  touchAction.disabled = !nearest;
  if (nearest) {
    const object = OBJECTS[nearest];
    byId('actionLabel').textContent = object.label;
    pin(roomAction, object.x, object.anchor);
  }
  markers.desk.hidden = (state.card && state.journal) || nearest === 'card' || nearest === 'journal';
  markers.rack.hidden = !state.journal || state.rack || nearest === 'rack';
  markers.terminal.hidden = !(state.card && state.journal && state.archiveRecovered) || state.reportConfirmed || nearest === 'terminal';
  markers.locker.hidden = !state.reportConfirmed || state.coupler || nearest === 'locker';
  markers.cooling.hidden = !state.coupler || state.coolingRestored || nearest === 'cooling';
  markers.exit.hidden = !state.coolingRestored || state.escaped || (!state.unlocked && nearest === 'exit');
  markers.exit.textContent = state.unlocked ? state.route + ' 通道' : '出口检测台';
  pin(markers.exit, state.unlocked ? PASSAGE_LANES[state.route].center : OBJECTS.exit.x, OBJECTS.exit.anchor);
}

function objective() {
  if (state.escaped) return '撤离完成';
  if (state.unlocked) return '从 ' + state.route + ' 通道撤离';
  if (state.passageSafe) return '提交实测结果给 ECHO';
  if (state.coolingRestored && !state.scannedA && !state.scannedB) return '请 ECHO 扫描通道';
  if (state.coolingRestored) return '核验出口通道';
  if (state.coupler) return '接通备用冷却';
  if (state.reportConfirmed) return '到维修柜取耦合器';
  if (state.password) return '查阅事故报告';
  if (state.identity && state.journal && state.archiveRecovered) return '推导终端密码';
  if (state.card && state.journal && state.archiveRecovered) return '到安全终端刷卡';
  if (state.rack && !state.archiveRecovered) return '请 ECHO 恢复存档';
  if (state.card && state.journal) return '读取机柜存档';
  return '调查办公桌';
}

function render() {
  const clues = state.card && state.journal && state.archiveRecovered && state.identity;
  const progress = [clues, state.reportConfirmed, state.coolingRestored, state.passageSafe, state.unlocked];
  byId('progressCount').textContent = progress.filter(Boolean).length + ' / ' + progress.length;
  progressBars.forEach((bar, index) => { bar.dataset.done = String(progress[index]); });
  byId('objective').textContent = objective();

  const door = state.escaped ? 'escaped' : state.unlocked ? 'unlocked' : 'locked';
  byId('stage').dataset.door = byId('doorStatus').dataset.state = door;
  byId('doorLabel').textContent = state.escaped ? '已撤离' : state.unlocked ? '出口已解锁' : '出口锁定';
  byId('cardSlot').disabled = !state.card || state.escaped;
  byId('journalSlot').disabled = !(state.journal || state.rack) || state.escaped;
  for (const button of evidenceButtons) button.disabled = byId('journalSlot').disabled;
  byId('journalEvidence').hidden = !state.journal;
  byId('rackEvidence').hidden = !state.rack;
  byId('rackClue').textContent = state.archiveRecovered ? RACK_CLUE : '归档数据损坏。请 ECHO 远程恢复时序记录。';
  byId('recoverArchive').hidden = !canEchoAct(state, 'recover_archive');
  byId('reportEvidence').hidden = !state.reportConfirmed;
  byId('recoveryEvidence').hidden = !state.coolingRestored;
  byId('recoverySummary').textContent = FLOW_RESULT +
    (state.passageSafe ? state.route + ' 通道通过检测。' : '出口通道待检测。');
  byId('scan').disabled = state.identity;
  byId('scanStatus').textContent = state.identity ? '身份已验证' : '等待身份验证';
  code.disabled = byId('submitCode').disabled = !state.identity || !state.journal || !state.archiveRecovered || state.password;
  byId('report').disabled = !state.password || state.reportOpen;
  byId('reportView').hidden = !state.reportOpen;
  byId('confirmReport').disabled = state.reportConfirmed;
  byId('confirmReport').textContent = state.reportConfirmed ? '已确认' : '确认已阅';
  byId('openEcho').disabled = state.escaped;
  byId('stateTrace').textContent = JSON.stringify(state, null, 2);
  devices.render();
  renderComms();
  renderTarget();
}

function clearMovement() {
  pressed.clear();
  for (const {button} of touch.values()) button.removeAttribute('data-held');
  touch.clear();
  player.moving = false;
}

function openPanel(panel) {
  if (panels.some(item => item.open)) return;
  clearMovement();
  panel.showModal();
}

for (const button of document.querySelectorAll('[data-close]')) {
  button.addEventListener('click', () => button.closest('dialog').close());
}

for (const button of evidenceButtons) {
  button.addEventListener('click', () => {
    evidenceSource = button;
    button.closest('dialog').close();
    openPanel(notebook);
  });
}

notebook.addEventListener('close', () => {
  if (!evidenceSource || notebook.open) return;
  const button = evidenceSource;
  evidenceSource = undefined;
  openPanel(button.closest('dialog'));
  button.focus();
});

const actions = {
  card() {
    state.card = true;
    player.pickupUntil = performance.now() + 240;
    setMessage('工作证已收起。' + objective() + '。');
  },
  journal() {
    if (!state.journal) {
      state.journal = true;
      setMessage('已收录研究日志。' + objective() + '。');
    }
    openPanel(notebook);
  },
  rack() {
    if (!state.rack) {
      state.rack = true;
      setMessage('机柜存档已损坏。按 Q 请 ECHO 恢复时序记录。');
    }
    openPanel(notebook);
  },
  locker() {
    if (!state.reportConfirmed) {
      setMessage('维修柜锁定。先在安全终端确认事故报告。');
      return;
    }
    if (state.coupler) {
      setMessage('耦合器已取出。' + objective() + '。');
      return;
    }
    state.coupler = true;
    player.pickupUntil = performance.now() + 240;
    setMessage('取得冷却耦合器。前往右侧的备用冷却设备。');
  },
  terminal() {
    if (state.identity && !state.password) {
      setTerminalNotice(state.journal && state.archiveRecovered
        ? '按实验发生顺序读取对应编号。调查记录可以随时回看。'
        : '身份已验证。查阅研究日志，并请 ECHO 恢复机柜存档。');
    }
    openPanel(terminal);
  },
  cooling() {
    openPanel(byId('coolingDialog'));
  },
  exit() {
    openPanel(byId('passageDialog'));
  }
};

function interact() {
  if (state.escaped || panels.some(panel => panel.open)) return;
  const key = nearbyObject(player, state);
  if (!key) return;
  actions[key]();
  nearest = nearbyObject(player, state);
  render();
}

roomAction.addEventListener('click', interact);
touchAction.addEventListener('click', interact);
byId('cardSlot').addEventListener('click', () => {
  setMessage(state.identity ? '身份已验证。' : '已取得研究员工作证。请到安全终端刷卡。');
});
byId('journalSlot').addEventListener('click', () => openPanel(notebook));

byId('scan').addEventListener('click', () => {
  if (!state.card) {
    setTerminalNotice('请先拾取办公桌上的工作证。', true);
    return;
  }
  state.identity = true;
  setTerminalNotice(state.journal && state.archiveRecovered ? '身份已验证。请按实验顺序输入四位密码。'
    : '身份已验证。查阅研究日志，并请 ECHO 恢复机柜存档。');
  render();
  if (!code.disabled) code.focus();
});

code.addEventListener('input', () => { code.value = code.value.replace(/[^0-9]/g, ''); });
byId('codeForm').addEventListener('submit', event => {
  event.preventDefault();
  if (code.disabled) return;
  if (code.value !== incident.digits.join('')) {
    setTerminalNotice('密码错误。请比对研究日志与机柜存档里的先后关系。', true);
    code.select();
    return;
  }
  state.password = true;
  setTerminalNotice('密码正确。事故报告已解锁。');
  render();
  byId('report').focus();
});
byId('report').addEventListener('click', () => {
  if (!state.password) return;
  state.reportOpen = true;
  setTerminalNotice('请阅读事故报告并确认已阅。');
  render();
  byId('confirmReport').focus();
});
byId('confirmReport').addEventListener('click', () => {
  if (!state.reportOpen) return;
  state.reportConfirmed = true;
  setTerminalNotice('已确认事故报告。到左下方的维修柜取得冷却耦合器。');
  render();
  terminal.close();
});

function addTurn(role, text) {
  const article = document.createElement('div');
  const author = document.createElement('strong');
  const body = document.createElement('p');
  article.className = 'turn';
  article.dataset.role = role;
  author.textContent = role === 'user' ? '研究员' : role === 'device' ? '设备回执' : 'ECHO';
  body.textContent = text;
  article.append(author, body);
  conversation.append(article);
  conversation.scrollTop = conversation.scrollHeight;
  return article;
}

function openEcho() {
  if (state.escaped) return;
  openPanel(chat);
  conversation.scrollTop = conversation.scrollHeight;
  if (desktopPointer.matches && !pending) chatInput.focus();
}

byId('openEcho').addEventListener('click', openEcho);
for (const id of ['recoverArchive', 'askAlignment', 'askScan']) {
  byId(id).addEventListener('click', event => {
    evidenceSource = undefined;
    event.currentTarget.closest('dialog').close();
    openEcho();
  });
}
chatInput.addEventListener('input', renderComms);
chatInput.addEventListener('keydown', event => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  if (!pending && chatInput.value.trim()) byId('chatForm').requestSubmit();
});

async function checkConnection() {
  try {
    const response = await fetch('/api/health', {cache: 'no-store'});
    if (!response.ok) throw new Error();
    const data = await response.json();
    connection = modeLabels[data.mode] ?? modeLabels.offline;
  } catch {
    connection = modeLabels.offline;
  }
  renderComms();
}

function applyEchoAction(action) {
  if (!canEchoAct(state, action)) return '设备状态已变化，请重新请求。';
  if (action === 'recover_archive') {
    state.archiveRecovered = true;
    return '机柜时序记录已恢复。打开调查记录，与研究日志核对。';
  }
  if (action === 'align_pipe') return devices.align();
  if (action === 'request_unlock') {
    state.unlocked = true;
    return '出口已解锁。关闭通讯，从亮绿灯的 ' + state.route + ' 通道撤离。';
  }
  const route = Object.keys(SCAN_ACTIONS).find(name => SCAN_ACTIONS[name] === action);
  if (route) {
    state[SCAN_FIELDS[route]] = true;
    return route + ' 通道扫描完成，读数已上传至出口检测台。';
  }
  return 'ECHO 已回复。';
}

byId('chatForm').addEventListener('submit', async event => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message || pending || state.escaped) return;
  const controller = new AbortController();
  pending = controller;
  const payload = {
    state: {...state}, history: history.slice(-10), message,
    incident: {kind: incident.kind, preferredScan: incident.preferredScan}
  };
  const turn = addTurn('user', message);
  chatInput.value = '';
  setChatStatus('ECHO 正在核验…');
  renderComms();
  try {
    const response = await fetch('/api/echo', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload), signal: controller.signal
    });
    const result = await response.json();
    if (pending !== controller) return;
    if (!response.ok) throw new Error(result.error);
    const {decision, messages, mode} = result;
    connection = mode === 'model' ? '模型在线' : modeLabels.demo;
    history.push({role: 'user', content: message}, {role: 'assistant', content: decision.reply});
    addTurn('assistant', decision.reply);

    const outcome = applyEchoAction(decision.action);
    if (decision.action !== 'reply') {
      addTurn('device', outcome);
      setMessage(outcome);
    }
    byId('echoTrace').textContent = JSON.stringify({mode, input: payload, messages, decision, outcome, stateAfter: state}, null, 2);
    setChatStatus();
    render();
  } catch (error) {
    if (pending !== controller) return;
    turn.remove();
    chatInput.value = message;
    setChatStatus(error.message || 'ECHO 暂时无法响应，请重试。', true);
  } finally {
    if (pending === controller) {
      pending = undefined;
      renderComms();
      if (chat.open && (document.activeElement === document.body || document.activeElement === byId('send')) &&
          desktopPointer.matches) chatInput.focus();
    }
  }
});

function syncViewport() {
  const viewport = window.visualViewport;
  if (!viewport) return;
  document.documentElement.style.setProperty('--visible-height', viewport.height + 'px');
  const covered = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
  document.documentElement.style.setProperty('--keyboard-offset', covered + 'px');
}

window.visualViewport?.addEventListener('resize', syncViewport);
window.visualViewport?.addEventListener('scroll', syncViewport);

window.addEventListener('keydown', event => {
  if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing || panels.some(panel => panel.open)) return;
  if (event.target instanceof Element && event.target.closest('input, textarea, [contenteditable]')) return;
  const direction = keys.get(event.code);
  if (direction) {
    event.preventDefault();
    if (!event.repeat) pressed.set(event.code, direction);
    return;
  }
  if (event.repeat) return;
  if (event.code === 'KeyE') interact();
  if (event.code === 'KeyQ') openEcho();
});
window.addEventListener('keyup', event => pressed.delete(event.code));
window.addEventListener('blur', clearMovement);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearMovement();
});

for (const button of document.querySelectorAll('[data-direction]')) {
  button.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    touch.set(event.pointerId, {direction: button.dataset.direction, button});
    button.dataset.held = 'true';
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    button.addEventListener(type, event => {
      touch.delete(event.pointerId);
      if (![...touch.values()].some(item => item.button === button)) button.removeAttribute('data-held');
    });
  }
}

function escapeRoom() {
  state.escaped = true;
  setMessage('撤离完成。实验室已进入维护模式。');
  byId('endingReport').textContent = '你经 ' + state.route + ' 通道撤离。备用冷却持续运行，实验室已进入维护模式。';
  render();
  openPanel(byId('endingDialog'));
}

function reset() {
  pending?.abort();
  pending = undefined;
  clearMovement();
  evidenceSource = undefined;
  panels.forEach(panel => panel.close());
  state = initialState();
  incident = createCase();
  byId('reportText').textContent = byId('reportSummary').textContent = incidentReport(incident.kind);
  const digits = [2, 0, 3, 1].map(index => {
    const entry = document.createElement('div');
    const name = document.createElement('dt');
    const value = document.createElement('dd');
    name.textContent = EXPERIMENTS[index].label;
    value.textContent = incident.digits[index];
    entry.append(name, value);
    return entry;
  });
  byId('experimentDigits').replaceChildren(...digits);
  devices.reset(incident);
  player = {...SPAWN, facing: 'down', moving: false, pickupUntil: 0};
  history = [];
  nearest = undefined;
  opening = 0;
  code.value = '';
  chatInput.value = '';
  conversation.replaceChildren();
  addTurn('assistant', '实验室已封锁。请验证身份并查阅事故报告。');
  byId('echoTrace').textContent = '尚无通讯记录。';
  setTerminalNotice(startNotice);
  setChatStatus();
  setMessage(openingMessage);
  render();
}

byId('reset').addEventListener('click', reset);
byId('playAgain').addEventListener('click', reset);

function frame(time) {
  const elapsed = Math.min(time - lastFrame, 35);
  const visualTime = motion.matches ? 0 : time;
  lastFrame = time;
  if (state.unlocked && opening < 1) opening = motion.matches ? 1 : Math.min(1, opening + elapsed / 580);

  player.moving = false;
  if (!state.escaped && !panels.some(panel => panel.open)) {
    const directions = [...pressed.values(), ...Array.from(touch.values(), item => item.direction)];
    const dx = Number(directions.includes('right')) - Number(directions.includes('left'));
    const dy = Number(directions.includes('down')) - Number(directions.includes('up'));
    if (dx || dy) {
      const stride = elapsed * 0.105 / Math.hypot(dx, dy);
      if (dx && (!dy || ['left', 'right'].includes(directions.at(-1)))) player.facing = dx < 0 ? 'left' : 'right';
      else player.facing = dy < 0 ? 'up' : 'down';
      player.moving = move(player, dx * stride, dy * stride, opening === 1 ? state.route : null);
    }
    const nearby = nearbyObject(player, state);
    if (nearby !== nearest) {
      nearest = nearby;
      renderTarget();
    }
    if (state.unlocked && player.y <= EXIT.threshold) escapeRoom();
  }

  paint(state, player, opening, pending, visualTime);
  if (chat.open) drawEcho(portrait, state.unlocked ? 'granted' : pending ? 'busy' : 'idle', visualTime);
  requestAnimationFrame(frame);
}

reset();
syncViewport();
checkConnection();
requestAnimationFrame(frame);
