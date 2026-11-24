import {phrase} from '../shared/i18n.mjs';
import {locale, localText, t} from './ui-language.mjs';
import {alignNextPipe, FLOW_RESULT, GRID_SIZE, pipeFault, PRESSURE_LIMIT, PARTICLE_LIMIT, rotatePipe, safePassage, traceCircuit} from '../shared/puzzles.mjs';
import {canEchoAct, SCAN_FIELDS} from '../shared/rules.mjs';

const byId = id => document.getElementById(id);
const directions = ['北', '东', '南', '西'];

export function describeRouteReadings({pressure, particles, interlock}) {
  return phrase('压差 {pressure} · 颗粒指数 {particles} · {interlock}', {
    pressure, particles, interlock: interlock ? '联锁响应' : '联锁无响应'
  });
}

export function createDevices(getState, feedback, render) {
  const grid = byId('pipeGrid');
  const circuit = byId('circuit');
  const test = byId('testPipes');
  const restart = byId('resetPipes');
  const routeForm = byId('passageForm');
  const routeOptions = byId('routeOptions');
  const submit = byId('submitRoute');
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
    byId('askScan').hidden = !state.coolingRestored || state.passageSafe || (state.scannedA && state.scannedB);
    routeForm.hidden = !state.coolingRestored;
    localText(byId('passageInstructions'), state.coolingRestored
      ? phrase('选择同时符合三项标准的通道。压差不高于 {pressure}，颗粒指数不高于 {particles}，门锁联锁必须响应。', {pressure: PRESSURE_LIMIT, particles: PARTICLE_LIMIT})
      : '检测台等待稳定冷却。恢复后，请 ECHO 扫描并上传通道读数。');
    for (const radio of routeOptions.querySelectorAll('input')) {
      const scanned = state[SCAN_FIELDS[radio.value]];
      radio.disabled = !scanned || state.passageSafe;
      const readings = incident.routes[radio.value];
      localText(radio.parentElement.querySelector('[data-reading]'), scanned ? describeRouteReadings(readings) : '等待 ECHO 扫描');
    }
    submit.disabled = state.passageSafe || !new FormData(routeForm).get('route');
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

  routeForm.addEventListener('change', () => {
    submit.disabled = getState().passageSafe || !new FormData(routeForm).get('route');
  });
  routeForm.addEventListener('submit', event => {
    event.preventDefault();
    const state = getState();
    const route = new FormData(routeForm).get('route');
    if (!state.coolingRestored || state.passageSafe || !Object.hasOwn(incident.routes, route) || !state[SCAN_FIELDS[route]]) return;
    if (!safePassage(incident.routes[route])) {
      notice('passageNotice', '登记被拒绝。请逐项比对压差、颗粒指数和联锁。', true);
      return;
    }
    state.passageSafe = true;
    state.route = route;
    for (const radio of routeOptions.querySelectorAll('input')) radio.disabled = true;
    submit.disabled = true;
    notice('passageNotice', phrase('{route} 通道通过检测。用实测结果向 ECHO 申请撤离。', {route}));
    feedback(phrase('{route} 通道通过检测。按 Q 联系 ECHO。', {route}));
    render();
  });

  return {
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
      notice('passageNotice');
    }
  };
}
