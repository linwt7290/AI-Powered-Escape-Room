import {phrase} from '../shared/i18n.mjs';
import {applyLanguage, locale, localText, t} from './ui-language.mjs';
import {canEchoAct, currentObjective, initialState, SCAN_ACTIONS, SCAN_FIELDS} from '../shared/rules.mjs';
import {DOORS, EXIT, HEIGHT, move, nearbyObject, nextDoor, OBJECTS, PASSAGE_LANES, PROP_BY_ROOM, ROOMS, SPAWN, WIDTH} from '../shared/room.mjs';
import {createRoomProps} from './room-props.mjs';
import {createPainter, drawEcho, drawTitleScene} from './pixel-art.mjs';
import {createCase, EXPERIMENTS, FLOW_RESULT, incidentReport, LOG_CLUE, RACK_CLUE} from '../shared/puzzles.mjs';
import {createDevices, describeRouteReadings} from './devices.mjs';
import {AIRLOCK_ACTIONS, applyAirlockAction, leaveChamber} from '../shared/airlock.mjs';
import {createAirlockPanel} from './airlock-panel.mjs';
import {checkEchoConfig, sendEchoMessage} from './echo/api.mjs';
import {progressSnapshot, TIMELINE_LIMIT} from '../shared/progress-timeline.mjs';

const byId = id => document.getElementById(id);
const titleScreen = byId('titleScreen');
const gameScreen = byId('gameScreen');
const intro = byId('introDialog');
const panels = [...document.querySelectorAll('dialog')];
const markers = Object.fromEntries(
  Array.from(document.querySelectorAll('[data-marker]'), element => [element.dataset.marker, element])
);
const doorSigns = [...document.querySelectorAll('[data-room-door]')];
const minimap = byId('minimap');
const mapRooms = Object.fromEntries(Object.entries(ROOMS).map(([room, {name, position, doors}]) => {
  const tile = document.createElement('span');
  tile.className = 'map-room';
  tile.textContent = name;
  tile.style.gridColumn = position[0];
  tile.style.gridRow = position[1];
  tile.toggleAttribute('data-east', Boolean(doors.east));
  tile.toggleAttribute('data-south', Boolean(doors.south));
  minimap.append(tile);
  return [room, tile];
}));
const progressBars = [...document.querySelectorAll('.progress-bars i')];
const roomAction = byId('roomAction');
const propMarker = byId('propMarker');
const stageTaskMark = byId('stageTaskMark');
const echoTaskMark = byId('echoTaskMark');
const touchAction = byId('touchAction');
const code = byId('code');
const terminal = byId('terminalDialog');
const notebook = byId('journalDialog');
const chat = byId('echoDialog');
const passage = byId('passageDialog');
const evidenceCards = byId('evidenceCards');
const notebookHost = notebook.querySelector('[data-evidence-host]');
const routeEvidence = [...document.querySelectorAll('[data-route-reading]')];
const evidenceButtons = [...document.querySelectorAll('[data-evidence]')];
const chatInput = byId('chatInput');
const conversation = byId('conversation');
const portrait = byId('echoPortrait');
const quickActions = [
  {label: '恢复机柜存档', text: '请恢复机柜存档。', actions: ['recover_archive']},
  {label: '请 ECHO 选择扫描对象', text: '请选择一条待查通道进行扫描。', actions: Object.values(SCAN_ACTIONS)},
  {label: '扫描 A 通道', text: '请扫描 A 通道。', actions: [SCAN_ACTIONS.A]},
  {label: '扫描 B 通道', text: '请扫描 B 通道。', actions: [SCAN_ACTIONS.B]}
].map(({label, text, actions}) => {
  const button = document.createElement('button');
  button.className = 'button';
  button.type = 'button';
  localText(button, label);
  button.addEventListener('click', () => {
    chatInput.value = t(text);
    byId('chatForm').requestSubmit();
  });
  byId('echoActions').append(button);
  return {button, actions};
});
let paint;
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const desktopPointer = matchMedia('(pointer: fine)');
const keys = new Map(Object.entries({
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right'
}));
const pressed = new Map();
const touch = new Map();
const taskHintsPreference = 'last-protocol-task-hints';
const echoSettingsPreference = 'last-protocol-echo-settings';
let showTaskHints = true;
let echoSettings = {apiBase: '', model: ''};
try {
  showTaskHints = localStorage.getItem(taskHintsPreference) !== 'off';
  const saved = JSON.parse(localStorage.getItem(echoSettingsPreference));
  if (typeof saved?.apiBase === 'string' && typeof saved.model === 'string') echoSettings = saved;
} catch {
  // The preference can still be changed for the current session.
}
const openingMessage = '实验室已封锁。先调查研究室的办公桌，沿门牌指引可进入其他房间。';
const startNotice = '请刷工作证，并用两份实验记录推导密码。';
const modeLabels = {
  model: '模型已配置', demo: '本地演示', incomplete: '模型配置不完整', offline: '服务未连接'
};

let state = initialState();
let incident;
let player = {...SPAWN, facing: 'down', moving: false, pickupUntil: 0};
let history = [];
const progressTimeline = [];
let progressStartedAt = performance.now();
let previousProgress = progressSnapshot(state, player.room);
let pending;
let connection = '正在连接';
let nearest;
const visitedRooms = new Set();
let evidenceSource;
let lastEchoTrace;
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
for (const sign of doorSigns) pin(sign, ...DOORS[sign.dataset.roomDoor].label);

const devices = createDevices(() => state, setMessage, render);
const airlockPanel = createAirlockPanel(() => state, publishAirlockEvent);
const roomProps = createRoomProps(openPanel, render);
localText(byId('journalClue'), LOG_CLUE);

function setMessage(message) {
  localText(byId('message'), message);
}

function setTerminalNotice(text, error = false) {
  const notice = byId('terminalNotice');
  localText(notice, text);
  notice.dataset.error = String(error);
  setMessage(text);
}

function setChatStatus(text = '', error = false) {
  const status = byId('chatStatus');
  localText(status, text);
  status.dataset.error = String(error);
  status.hidden = !text;
}

function renderComms() {
  localText(byId('echoStatus'), connection);
  const pressure = byId('echoPressure');
  pressure.hidden = !state.coolingFaultRow;
  if (!pressure.hidden) localText(pressure, phrase('ECHO 检测到第 {row} 行掉压。', {row: state.coolingFaultRow}));
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
    localText(byId('actionLabel'), object.label);
    pin(roomAction, object.x, object.anchor);
  }
  const prop = PROP_BY_ROOM[player.room];
  propMarker.hidden = !prop || nearest === prop;
  if (!propMarker.hidden) {
    const {x, anchor, title} = OBJECTS[prop];
    pin(propMarker, x, anchor);
    localText(propMarker, title);
  }
  markers.desk.hidden = player.room !== 'research' || (state.card && state.journal) || nearest === 'card' || nearest === 'journal';
  markers.rack.hidden = player.room !== 'archive' || !state.journal || state.rack || nearest === 'rack';
  markers.terminal.hidden = player.room !== 'control' || !(state.card && state.journal && state.archiveRecovered) ||
    state.reportConfirmed || nearest === 'terminal';
  markers.locker.hidden = player.room !== 'maintenance' || !state.reportConfirmed || nearest === 'locker' ||
    (state.coupler && (!state.airlock.authorized || state.airlock.spare || state.unlocked));
  markers.cooling.hidden = player.room !== 'maintenance' || !state.coupler || state.coolingRestored || nearest === 'cooling';
  markers.exit.hidden = player.room !== 'exit' || !state.coolingRestored || state.escaped || (!state.unlocked && nearest === 'exit');
  localText(markers.exit, state.unlocked ? phrase('{route} 通道', {route: state.route}) : state.airlock.authorized ? '撤离缓冲舱' : '出口检测台');
  pin(markers.exit, state.unlocked ? PASSAGE_LANES[state.route].center : OBJECTS.exit.x, OBJECTS.exit.anchor);
}

function renderRoom() {
  const {name, doors} = ROOMS[player.room];
  visitedRooms.add(player.room);
  localText(byId('roomName'), name);
  localText(byId('roomsExplored'), phrase('已探索 {visited} / {total}', {visited: visitedRooms.size, total: Object.keys(ROOMS).length}));
  for (const [room, tile] of Object.entries(mapRooms)) {
    const visited = visitedRooms.has(room);
    tile.dataset.visited = String(visited);
    localText(tile, ROOMS[room].name);
    tile.setAttribute('aria-label', t(phrase(visited ? '{room}，已到访' : '{room}，未到访', {room: ROOMS[room].name})));
    if (room === player.room) tile.setAttribute('aria-current', 'location');
    else tile.removeAttribute('aria-current');
  }
  const destinations = [];
  for (const sign of doorSigns) {
    const side = sign.dataset.roomDoor;
    const destination = doors[side];
    sign.hidden = !destination;
    if (!destination) continue;
    const {name: target} = ROOMS[destination];
    localText(sign, target);
    destinations.push(t(target));
  }
  byId('room').setAttribute('aria-label', t(phrase('{room}。相邻房间 {neighbors}', {room: name, neighbors: destinations.join(locale() === 'en' ? ', ' : '、')})));
}

function renderObjective() {
  const {label, target} = currentObjective(state);
  localText(byId('objective'), label);
  echoTaskMark.hidden = !showTaskHints || target !== 'echo';
  stageTaskMark.hidden = !showTaskHints || !target || target === 'echo';
  if (stageTaskMark.hidden) return;

  const object = OBJECTS[target === 'lane' ? 'exit' : target];
  if (player.room !== object.room) {
    const door = nextDoor(player.room, object.room);
    stageTaskMark.hidden = !door;
    if (door) pin(stageTaskMark, ...DOORS[door].label);
    return;
  }

  const x = target === 'lane' ? PASSAGE_LANES[state.route].center : object.x;
  pin(stageTaskMark, x, object.anchor);
}

function render() {
  const snapshot = progressSnapshot(state, player.room);
  const changes = Object.entries(snapshot).filter(([field, value]) => value !== previousProgress[field]);
  if (changes.length) {
    progressTimeline.push({atMs: Math.floor(performance.now() - progressStartedAt), changes: Object.fromEntries(changes)});
    if (progressTimeline.length > TIMELINE_LIMIT) progressTimeline.shift();
    previousProgress = snapshot;
  }
  const clues = state.card && state.journal && state.archiveRecovered && state.identity;
  const progress = [clues, state.reportConfirmed, state.coolingRestored, state.passageSafe, state.unlocked];
  byId('progressCount').textContent = progress.filter(Boolean).length + ' / ' + progress.length;
  progressBars.forEach((bar, index) => { bar.dataset.done = String(progress[index]); });
  renderObjective();

  const door = state.escaped ? 'escaped' : state.unlocked ? 'unlocked' : 'locked';
  byId('stage').dataset.door = byId('doorStatus').dataset.state = door;
  localText(byId('doorLabel'), state.escaped ? '已撤离' : state.unlocked ? '出口已解锁'
    : state.airlock.authorized ? '撤离已授权' : '出口锁定');
  byId('cardSlot').disabled = !state.card || state.escaped;
  const hasEvidence = state.journal || state.rack || state.reportConfirmed || state.coolingRestored || roomProps.active.shiftLog;
  byId('journalSlot').disabled = !hasEvidence || state.escaped;
  for (const button of evidenceButtons) button.disabled = byId('journalSlot').disabled;
  byId('journalEvidence').hidden = !state.journal;
  byId('rackEvidence').hidden = !state.rack;
  localText(byId('rackClue'), state.archiveRecovered ? RACK_CLUE : '归档数据损坏。请 ECHO 远程恢复时序记录。');
  byId('recoverArchive').hidden = !canEchoAct(state, 'recover_archive');
  byId('reportEvidence').hidden = !state.reportConfirmed;
  byId('recoveryEvidence').hidden = !state.coolingRestored;
  byId('shiftEvidence').hidden = !roomProps.active.shiftLog;
  for (const reading of routeEvidence) {
    const route = reading.dataset.routeReading;
    reading.hidden = !state[SCAN_FIELDS[route]];
    if (!reading.hidden) {
      reading.textContent = t(phrase('{route} 通道', {route})) + ' · ' + t(describeRouteReadings(incident.routes[route]));
    }
  }
  byId('recoverySummary').textContent = t(FLOW_RESULT) + ' ' + t(state.passageSafe
    ? phrase('{route} 通道通过检测。', {route: state.route}) : '出口通道待检测。');
  byId('reportText').textContent = byId('reportSummary').textContent = incidentReport(incident.kind, locale());
  byId('scan').disabled = state.identity;
  localText(byId('scanStatus'), state.identity ? '身份已验证' : '等待身份验证');
  code.disabled = byId('submitCode').disabled = !state.identity || !state.journal || !state.archiveRecovered || state.password;
  byId('report').disabled = !state.password || state.reportOpen;
  byId('reportView').hidden = !state.reportOpen;
  byId('confirmReport').disabled = state.reportConfirmed;
  localText(byId('confirmReport'), state.reportConfirmed ? '已确认' : '确认已阅');
  byId('openEcho').disabled = state.escaped;
  byId('stateTrace').textContent = JSON.stringify({...state, room: player.room}, null, 2);
  devices.render();
  airlockPanel.render();
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

const settings = byId('settingsDialog');
const languageOptions = [...settings.querySelectorAll('input[name="language"]')];
const taskHints = byId('taskHints');
const echoSettingsForm = byId('echoSettingsForm');
const echoApiBase = byId('echoApiBase');
const echoModel = byId('echoModel');
const echoSettingsError = byId('echoSettingsError');
const echoSettingsSubmit = echoSettingsForm.querySelector('button');
const echoSettingsFields = echoSettingsForm.querySelector('fieldset');
let settingsValidation;
function openSettings() {
  for (const option of languageOptions) option.checked = option.value === locale();
  taskHints.checked = showTaskHints;
  echoApiBase.value = echoSettings.apiBase;
  echoModel.value = echoSettings.model;
  echoSettingsError.hidden = true;
  openPanel(settings);
}
byId('openSettings').addEventListener('click', openSettings);
byId('openTitleSettings').addEventListener('click', openSettings);
echoSettingsForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (settingsValidation) return;
  const next = {apiBase: echoApiBase.value.trim(), model: echoModel.value.trim()};
  if (next.apiBase === echoSettings.apiBase && next.model === echoSettings.model) {
    settings.close();
    return;
  }
  const controller = new AbortController();
  settingsValidation = controller;
  echoSettingsError.hidden = true;
  echoSettingsSubmit.disabled = true;
  echoSettingsFields.disabled = true;
  try {
    const mode = await checkEchoConfig(next, controller.signal);
    if (controller.signal.aborted || !settings.open) return;
    echoSettings = next;
    try {
      localStorage.setItem(echoSettingsPreference, JSON.stringify(next));
    } catch {
      // The current session still keeps the new settings.
    }
    connection = modeLabels[mode];
    renderComms();
    settings.close();
  } catch (error) {
    if (controller.signal.aborted || !settings.open) return;
    localText(echoSettingsError, error.message);
    echoSettingsError.hidden = false;
  } finally {
    settingsValidation = undefined;
    echoSettingsSubmit.disabled = false;
    echoSettingsFields.disabled = false;
  }
});
settings.addEventListener('close', () => {
  if (!settings.open) settingsValidation?.abort();
});
taskHints.addEventListener('change', () => {
  showTaskHints = taskHints.checked;
  try {
    localStorage.setItem(taskHintsPreference, showTaskHints ? 'on' : 'off');
  } catch {
    // The current session still keeps the new value.
  }
  if (!gameScreen.hidden) renderObjective();
});
for (const option of languageOptions) {
  option.addEventListener('change', () => {
    if (!option.checked) return;
    applyLanguage(option.value);
    if (gameScreen.hidden) return;
    devices.refreshLanguage();
    renderRoom();
    render();
    if (!lastEchoTrace) byId('echoTrace').textContent = t('尚无通讯记录。');
  });
}

for (const button of document.querySelectorAll('[data-close]')) {
  button.addEventListener('click', () => button.closest('dialog').close());
}

function closeInlineEvidence() {
  if (!evidenceSource) return;
  evidenceSource.setAttribute('aria-expanded', 'false');
  evidenceSource.closest('dialog').querySelector('[data-evidence-host]').hidden = true;
  evidenceSource = undefined;
}

function openNotebook(card) {
  closeInlineEvidence();
  notebookHost.append(evidenceCards);
  if (card) byId(card).open = true;
  openPanel(notebook);
}

for (const button of evidenceButtons) {
  button.addEventListener('click', () => {
    const alreadyOpen = evidenceSource === button;
    closeInlineEvidence();
    if (alreadyOpen) return;
    const host = button.closest('dialog').querySelector('[data-evidence-host]');
    host.append(evidenceCards);
    host.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    evidenceSource = button;
  });
}
for (const panel of panels) {
  panel.addEventListener('close', () => {
    if (!panel.open && evidenceSource?.closest('dialog') === panel) closeInlineEvidence();
  });
}

const actions = {
  card() {
    state.card = true;
    player.pickupUntil = performance.now() + 240;
    setMessage('工作证已收起。');
  },
  journal() {
    if (!state.journal) {
      state.journal = true;
      setMessage('已收录研究日志。');
    }
    openNotebook('journalEvidence');
  },
  rack() {
    if (!state.rack) {
      state.rack = true;
      setMessage('机柜存档已损坏。按 Q 请 ECHO 恢复时序记录。');
    }
    openNotebook('rackEvidence');
  },
  locker() {
    if (!state.reportConfirmed) {
      setMessage('维修柜锁定。先在安全终端确认事故报告。');
      return;
    }
    if (state.coupler) {
      openPanel(byId('sparesDialog'));
      return;
    }
    state.coupler = true;
    player.pickupUntil = performance.now() + 240;
    setMessage('取得冷却耦合器。检修维修间的备用冷却设备。');
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
    if (state.airlock.authorized) openEcho({airlock: true});
    else openPanel(passage);
  }
};

function interact() {
  if (state.escaped || panels.some(panel => panel.open)) return;
  const key = nearbyObject(player, state);
  if (!key) return;
  if (actions[key]) actions[key]();
  else roomProps.open(key);
  nearest = nearbyObject(player, state);
  render();
}

roomAction.addEventListener('click', interact);
touchAction.addEventListener('click', interact);
byId('cardSlot').addEventListener('click', () => {
  setMessage(state.identity ? '身份已验证。' : '已取得研究员工作证。请到安全终端刷卡。');
});
byId('journalSlot').addEventListener('click', () => openNotebook());

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
  setTerminalNotice('已确认事故报告。去维修间，从维修柜取得冷却耦合器。');
  render();
  terminal.close();
});

function addTurn(role, text, localized = role === 'device') {
  const article = document.createElement('div');
  const author = document.createElement('strong');
  const body = document.createElement('p');
  article.className = 'turn';
  article.dataset.role = role;
  localText(author, role === 'user' ? '研究员' : role === 'device' ? '设备回执' : 'ECHO');
  if (localized) localText(body, text);
  else body.textContent = text;
  article.append(author, body);
  conversation.append(article);
  conversation.scrollTop = conversation.scrollHeight;
  return article;
}

function publishAirlockEvent(outcome) {
  addTurn('device', outcome);
  setMessage(outcome);
  if (lastEchoTrace) {
    lastEchoTrace.deviceEvents.push({outcome: t(outcome), stateAfter: structuredClone(state)});
    byId('echoTrace').textContent = JSON.stringify(lastEchoTrace, null, 2);
  }
  render();
}

function openEcho({airlock = player.room === 'exit' && state.airlock.authorized && !state.unlocked} = {}) {
  if (state.escaped) return;
  chat.dataset.console = airlock ? 'airlock' : 'comms';
  airlockPanel.render();
  openPanel(chat);
  conversation.scrollTop = conversation.scrollHeight;
  if (desktopPointer.matches && !pending && !airlock) chatInput.focus();
}

byId('openEcho').addEventListener('click', () => openEcho());
for (const id of ['recoverArchive', 'askAlignment', 'askScan']) {
  byId(id).addEventListener('click', event => {
    const source = event.currentTarget.closest('dialog');
    if (source === chat) {
      chatInput.value = t('请恢复机柜存档。');
      renderComms();
      chatInput.focus();
      return;
    }
    closeInlineEvidence();
    source.close();
    openEcho();
  });
}
chat.addEventListener('close', () => {
  if (chat.open || chat.dataset.console !== 'airlock') return;
  chat.dataset.console = 'comms';
  const outcome = leaveChamber(state.airlock, locale());
  if (outcome) publishAirlockEvent(outcome);
});
chatInput.addEventListener('input', renderComms);
chatInput.addEventListener('keydown', event => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  if (!pending && chatInput.value.trim()) byId('chatForm').requestSubmit();
});

async function checkConnection() {
  const requested = echoSettings;
  let mode;
  try {
    mode = await checkEchoConfig(requested);
  } catch {
    mode = 'offline';
  }
  if (requested !== echoSettings || connection === '模型在线') return;
  connection = modeLabels[mode];
  renderComms();
}

function applyEchoAction({action, row, column}) {
  if (!canEchoAct(state, action)) return '设备状态已变化，请重新请求。';
  if (action === 'recover_archive') {
    state.archiveRecovered = true;
    return '机柜时序记录已恢复。打开调查记录，与研究日志核对。';
  }
  if (action === 'align_pipe') return devices.align();
  if (action === 'isolate_pipe') return devices.isolate(row, column);
  if (action === 'request_unlock') {
    state.airlock.authorized = true;
    return phrase('撤离已授权。前往撤离区，操作 {route} 通道的缓冲舱。', {route: state.route});
  }
  if (Object.values(AIRLOCK_ACTIONS).includes(action)) return applyAirlockAction(state, action, locale());
  const route = Object.keys(SCAN_ACTIONS).find(name => SCAN_ACTIONS[name] === action);
  if (route) {
    state[SCAN_FIELDS[route]] = true;
    return phrase('{route} 通道扫描完成，读数已上传至出口检测台。', {route});
  }
  return 'ECHO 已回复。';
}

byId('chatForm').addEventListener('submit', async event => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message || pending || state.escaped) return;
  const controller = new AbortController();
  pending = controller;
  const requested = echoSettings;
  const payload = {
    state: structuredClone(state), room: player.room, history: history.slice(-10), message,
    progressTimeline: progressTimeline.slice(),
    incident: {kind: incident.kind, preferredScan: incident.preferredScan}
  };
  const turn = addTurn('user', message);
  chatInput.value = '';
  setChatStatus('ECHO 正在核验…');
  renderComms();
  try {
    const {ok, data: result} = await sendEchoMessage({...payload, echoSettings: requested}, controller.signal);
    if (pending !== controller) return;
    if (!ok) throw new Error(result.error);
    const {decision, messages, mode} = result;
    if (requested === echoSettings) connection = mode === 'model' ? '模型在线' : modeLabels.demo;
    history.push({role: 'user', content: message}, {role: 'assistant', content: decision.reply});
    addTurn('assistant', decision.reply);

    const outcome = applyEchoAction(decision);
    if (decision.action !== 'reply') {
      addTurn('device', outcome);
      setMessage(outcome);
    }
    lastEchoTrace = {mode, input: payload, messages, decision, outcome: t(outcome), stateAfter: structuredClone(state), deviceEvents: []};
    byId('echoTrace').textContent = JSON.stringify(lastEchoTrace, null, 2);
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
  if (gameScreen.hidden || event.ctrlKey || event.altKey || event.metaKey || event.isComposing || panels.some(panel => panel.open)) return;
  if (event.target instanceof Element && event.target.closest('input, textarea, [contenteditable]')) return;
  const direction = keys.get(event.code);
  if (direction) {
    event.preventDefault();
    if (!event.repeat) pressed.set(event.code, direction);
    return;
  }
  if (event.repeat) return;
  if (event.code === 'KeyE') interact();
  if (event.code === 'KeyQ') {
    event.preventDefault();
    openEcho();
  }
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
  localText(byId('endingReport'), phrase('你经 {route} 通道撤离。备用冷却持续运行，实验室已进入维护模式。', {route: state.route}));
  render();
  const endingEcho = byId('endingEcho');
  endingEcho.hidden = !roomProps.active.brewedCoffee;
  localText(endingEcho, 'ECHO：你刚才还冲了杯咖啡。夜班结束，辛苦了。');
  openPanel(byId('endingDialog'));
}

function reset() {
  pending?.abort();
  pending = undefined;
  clearMovement();
  closeInlineEvidence();
  notebookHost.append(evidenceCards);
  for (const card of evidenceCards.querySelectorAll('details')) card.open = false;
  chat.dataset.console = 'comms';
  lastEchoTrace = undefined;
  panels.forEach(panel => panel.close());
  state = initialState();
  incident = createCase();
  const digits = [2, 0, 3, 1].map(index => {
    const entry = document.createElement('div');
    const name = document.createElement('dt');
    const value = document.createElement('dd');
    localText(name, EXPERIMENTS[index].label);
    value.textContent = incident.digits[index];
    entry.append(name, value);
    return entry;
  });
  byId('experimentDigits').replaceChildren(...digits);
  devices.reset(incident);
  airlockPanel.reset(incident);
  roomProps.reset();
  player = {...SPAWN, facing: 'down', moving: false, pickupUntil: 0};
  visitedRooms.clear();
  progressTimeline.length = 0;
  progressStartedAt = performance.now();
  previousProgress = progressSnapshot(state, player.room);
  history = [];
  nearest = undefined;
  opening = 0;
  code.value = '';
  chatInput.value = '';
  conversation.replaceChildren();
  addTurn('assistant', '实验室已封锁。请验证身份并查阅事故报告。', true);
  byId('echoTrace').textContent = t('尚无通讯记录。');
  setTerminalNotice(startNotice);
  setChatStatus();
  setMessage(openingMessage);
  renderRoom();
  render();
}

byId('reset').addEventListener('click', reset);
byId('playAgain').addEventListener('click', reset);
byId('startGame').addEventListener('click', () => openPanel(intro));
byId('enterLab').addEventListener('click', () => {
  if (!gameScreen.hidden) return;
  intro.close();
  titleScreen.hidden = true;
  gameScreen.hidden = false;
  paint = createPainter(byId('room'));
  reset();
  checkConnection();
  byId('gameTitle').focus();
  lastFrame = performance.now();
  requestAnimationFrame(frame);
});

function frame(time) {
  const elapsed = Math.min(time - lastFrame, 35);
  const visualTime = motion.matches ? 0 : time;
  lastFrame = time;
  airlockPanel.update(time);
  if (state.unlocked && opening < 1) opening = motion.matches ? 1 : Math.min(1, opening + elapsed / 580);

  player.moving = false;
  if (!state.escaped && !panels.some(panel => panel.open)) {
    const previousRoom = player.room;
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
    if (player.room !== previousRoom) {
      nearest = nearby;
      renderRoom();
      render();
    } else if (nearby !== nearest) {
      nearest = nearby;
      renderTarget();
    }
    if (player.room === 'exit' && state.unlocked && player.y <= EXIT.threshold) escapeRoom();
  }

  paint(state, player, opening, pending, visualTime, roomProps.active);
  if (chat.open) drawEcho(portrait, state.unlocked ? 'granted' : pending ? 'busy' : 'idle', visualTime);
  requestAnimationFrame(frame);
}

applyLanguage();
drawTitleScene(byId('titleScene'));
syncViewport();
