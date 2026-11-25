import {phrase} from '../shared/i18n.mjs';
import {locale, localText, t} from './ui-language.mjs';
import {alignNextPipe, FLOW_RESULT, GRID_SIZE, passageFailures, pipeFault, rotatePipe, traceCircuit} from '../shared/puzzles.mjs';
import {missingPassageStandards, PASSAGE_STANDARDS} from '../shared/passage-standards.mjs';
import {canEchoAct, confirmPassage, SCAN_FIELDS} from '../shared/rules.mjs';

const byId = id => document.getElementById(id);
const directions = ['北', '东', '南', '西'];

export function describeRouteReadings({pressure, particles, interlock}) {
  return phrase('压差 {pressure} · 颗粒指数 {particles} · {interlock}', {
    pressure, particles, interlock: interlock ? '联锁响应' : '联锁无响应'
  });
}

export function createDevices(getState, feedback, render, openChamber) {
  const grid = byId('pipeGrid');
  const circuit = byId('circuit');
  const test = byId('testPipes');
  const restart = byId('resetPipes');
  const routeForm = byId('passageForm');
  const routeOptions = byId('routeOptions');
  const submit = byId('submitRoute');
  const launch = byId('launchEvacuation');
  let candidateRoute;
  let incident;
  let tiles;
  let trial;
  const bypasses = new Map();
  let buttons;

  function notice(id, message = '', error = false) {
    const target = byId(id);
    target.hidden = !message;
    localText(target, message);
    target.dataset.error = String(error);
  }

  function renderPipes() {
    buttons.forEach((button, index) => {
      const ports = tiles[index];
      button.replaceChildren();
      const openings = [];
      for (const [side, direction] of directions.entries()) {
        if (!(ports & (1 << side))) continue;
        const arm = document.createElement('span');
        arm.className = 'pipe-arm';
        arm.dataset.side = side;
        button.append(arm);
        openings.push(t(direction));
      }
      button.dataset.power = trial?.fault === index ? 'leak' : trial?.energized.includes(index) ? 'flow'
        : bypasses.has(index) ? 'adjusted' : 'idle';
      const row = Math.floor(index / GRID_SIZE) + 1;
      const column = index % GRID_SIZE + 1;
      button.setAttribute('aria-label', t(phrase('第 {row} 行第 {column} 列，接口朝{directions}', {row, column, directions: openings.join(locale() === 'en' ? ', ' : '、')})));
      button.disabled = getState().coolingRestored || bypasses.has(index);
    });
    test.disabled = restart.disabled = getState().coolingRestored;
  }

  function restoreTiles() {
    tiles = [...incident.tiles];
    trial = undefined;
    for (const [index, ports] of bypasses) tiles[index] = ports;
    notice('coolingNotice');
    renderPipes();
  }

  function drawRoutes() {
    candidateRoute = undefined;
    routeOptions.replaceChildren();
    for (const name of Object.keys(incident.routes)) {
      const label = document.createElement('label');
      label.className = 'route-option';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'route';
      radio.value = name;
      const title = document.createElement('strong');
      localText(title, phrase('{route} 通道', {route: name}));
      const summary = document.createElement('span');
      summary.dataset.reading = name;
      label.append(radio, title, summary);
      routeOptions.append(label);
    }
  }

  function renderDevices() {
    const state = getState();
    circuit.hidden = !state.reportConfirmed || !state.coupler;
    localText(byId('coolingInstructions'), state.coolingRestored ? '回路已锁定，备用冷却正在运行。'
      : !state.reportConfirmed ? '设备停机。先在安全终端查阅事故报告。'
        : !state.coupler ? '耦合器缺失。到维修柜取件后返回这里。'
          : '耦合器已装入。旋转管段，让左上入口与右下出口连通，再执行试压。');
    localText(byId('pressureReading'), state.coolingFaultRow
      ? phrase('ECHO 检测到第 {row} 行掉压。', {row: state.coolingFaultRow}) : '执行一次试压以获取读数。');
    byId('pressureReading').hidden = state.coolingRestored;
    const pendingScans = Object.keys(SCAN_FIELDS).filter(route => !state[SCAN_FIELDS[route]]);
    const missing = missingPassageStandards(state.standards);
    byId('askScan').hidden = !state.coolingRestored || state.passageSafe || (!pendingScans.length && !missing.length);
    localText(byId('askScan'), pendingScans.length ? '联系 ECHO 扫描' : '向 ECHO 查询缺失标准');
    routeForm.hidden = byId('evacuationControls').hidden = !state.coolingRestored;
    localText(byId('passageInstructions'), state.coolingRestored
      ? '选择已扫描的通道，核验已知项目并暂存路线。'
      : '检测台等待稳定冷却。恢复后，请 ECHO 扫描并上传通道读数。');
    const standards = state.standards;
    byId('passageStandards').replaceChildren(...Object.entries(PASSAGE_STANDARDS).map(([id, clue]) => {
      const item = document.createElement('li');
      localText(item, standards[id] ? clue.reading : clue.location);
      return item;
    }));
    for (const radio of routeOptions.querySelectorAll('input')) {
      const scanned = state[SCAN_FIELDS[radio.value]];
      radio.disabled = !scanned;
      const readings = incident.routes[radio.value];
      localText(radio.parentElement.querySelector('[data-reading]'), scanned ? describeRouteReadings(readings) : '等待 ECHO 扫描');
    }
    const selected = new FormData(routeForm).get('route');
    submit.disabled = !selected;
    launch.disabled = !candidateRoute || selected !== candidateRoute || Boolean(pendingScans.length || missing.length) ||
      state.airlock.authorized;
    const blockers = [
      ...pendingScans.map(route => phrase('等待扫描 {route} 通道。', {route})),
      ...missing.map(id => PASSAGE_STANDARDS[id].location)
    ];
    if (!candidateRoute || selected !== candidateRoute) blockers.push('请先核验并暂存所选路线。');
    byId('evacuationBlockers').replaceChildren(...blockers.map(message => {
      const item = document.createElement('li');
      localText(item, message);
      return item;
    }));
    byId('evacuationBlockers').hidden = !blockers.length;

    const results = byId('routeVerification');
    results.hidden = !candidateRoute;
    if (candidateRoute) {
      localText(byId('routeCandidate'), phrase('已暂存 {route} 通道', {route: candidateRoute}));
      const failures = passageFailures(incident.routes[candidateRoute]);
      const criteria = {lights: ['压差', 'pressure'], microscope: ['颗粒指数', 'particles'], photo: ['门锁联锁', 'interlock']};
      byId('routeVerificationItems').replaceChildren(...Object.entries(criteria).map(([id, [name, metric]]) => {
        const result = !standards[id] ? '标准待查' : failures.includes(metric) ? '不符合' : '符合';
        const item = document.createElement('li');
        localText(item, phrase('{name}：{result}', {name, result}));
        return item;
      }));
    }
  }

  restart.addEventListener('click', () => {
    getState().coolingFaultRow = null;
    restoreTiles();
    render();
  });
  test.addEventListener('click', () => {
    const state = getState();
    if (!state.reportConfirmed || !state.coupler || state.coolingRestored) return;
    trial = traceCircuit(tiles);
    state.coolingFaultRow = null;
    if (trial.connected) {
      state.coolingRestored = true;
      notice('coolingNotice', FLOW_RESULT);
      feedback('备用冷却已恢复。到出口检测台核对通道读数。');
    } else {
      trial.fault = pipeFault(tiles);
      state.coolingFaultRow = Math.floor(trial.fault / GRID_SIZE) + 1;
      notice('coolingNotice', '试压未通过。可以手动旋转标红的接头，或按 Q 请 ECHO 旁通漏点。', true);
    }
    renderPipes();
    render();
  });

  routeForm.addEventListener('change', renderDevices);
  routeForm.addEventListener('submit', event => {
    event.preventDefault();
    const state = getState();
    const route = new FormData(routeForm).get('route');
    if (!state.coolingRestored || !Object.hasOwn(SCAN_FIELDS, route) || !state[SCAN_FIELDS[route]]) return;
    candidateRoute = route;
    renderDevices();
  });

  launch.addEventListener('click', () => {
    const state = getState();
    const route = new FormData(routeForm).get('route');
    if (!candidateRoute || route !== candidateRoute) return;
    if (confirmPassage(state, incident.routes, route) !== 'confirmed') return;
    feedback(phrase('已确认 {route} 通道。请操作缓冲舱。', {route}));
    openChamber();
    render();
  });

  return {
    get routeReady() {
      return Boolean(candidateRoute) && new FormData(routeForm).get('route') === candidateRoute;
    },
    render: renderDevices,
    refreshLanguage: renderPipes,
    get coolingTrial() { return trial; },
    isolate(requestTrial) {
      const index = trial?.fault;
      if (!canEchoAct(getState(), 'isolate_pipe') || index === undefined || trial !== requestTrial) {
        return '试压结果已变化，请根据当前读数重新请求。';
      }
      alignNextPipe(tiles);
      bypasses.set(index, tiles[index]);
      getState().coolingFaultRow = null;
      trial = undefined;
      const result = phrase('已旁通第 {row} 行第 {column} 列的接头。请重新试压。', {
        row: Math.floor(index / GRID_SIZE) + 1, column: index % GRID_SIZE + 1
      });
      notice('coolingNotice', result);
      renderPipes();
      return result;
    },
    align() {
      if (traceCircuit(tiles).connected) return '当前回路已连通，可以直接试压。';
      const adjusted = alignNextPipe(tiles);
      if (adjusted === null) return '管路已对齐，可以执行试压。';
      bypasses.set(adjusted, tiles[adjusted]);
      getState().alignedPipe = true;
      trial = undefined;
      const result = phrase('ECHO 已校准第 {row} 行第 {column} 列。其余管段由你查验。', {
        row: Math.floor(adjusted / GRID_SIZE) + 1, column: adjusted % GRID_SIZE + 1
      });
      notice('coolingNotice', result);
      renderPipes();
      return result;
    },
    reset(nextIncident) {
      incident = nextIncident;
      bypasses.clear();
      buttons = incident.tiles.map((_, index) => {
        const button = document.createElement('button');
        button.className = 'pipe-tile';
        button.type = 'button';
        button.addEventListener('click', () => {
          tiles[index] = rotatePipe(tiles[index]);
          trial = undefined;
          const needsRender = getState().coolingFaultRow !== null;
          getState().coolingFaultRow = null;
          notice('coolingNotice');
          renderPipes();
          if (needsRender) render();
        });
        return button;
      });
      grid.replaceChildren(...buttons);
      restoreTiles();
      drawRoutes();
      submit.disabled = true;
      }
  };
}
