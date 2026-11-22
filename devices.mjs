import {alignNextPipe, FLOW_RESULT, GRID_SIZE, PRESSURE_LIMIT, PARTICLE_LIMIT, rotatePipe, safePassage, traceCircuit} from './puzzles.mjs';
import {canEchoAct, SCAN_FIELDS} from './rules.mjs';

const byId = id => document.getElementById(id);
const directions = ['北', '东', '南', '西'];

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
  let adjusted;
  let calibration;
  let buttons;

  function notice(id, message = '', error = false) {
    const target = byId(id);
    target.hidden = !message;
    target.textContent = message;
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
        openings.push(direction);
      }
      button.dataset.power = trial?.leak === index ? 'leak' : trial?.energized.includes(index) ? 'flow'
        : adjusted === index ? 'adjusted' : 'idle';
      const row = Math.floor(index / GRID_SIZE) + 1;
      const column = index % GRID_SIZE + 1;
      button.setAttribute('aria-label', '第 ' + row + ' 行第 ' + column + ' 列，接口朝' + openings.join('、'));
      button.disabled = getState().coolingRestored;
    });
    test.disabled = restart.disabled = getState().coolingRestored;
  }

  function restoreTiles() {
    tiles = [...incident.tiles];
    trial = undefined;
    adjusted = calibration?.index;
    if (calibration) tiles[calibration.index] = calibration.ports;
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
      title.textContent = name + ' 通道';
      const summary = document.createElement('span');
      summary.dataset.reading = name;
      label.append(radio, title, summary);
      routeOptions.append(label);
    }
  }

  function renderDevices() {
    const state = getState();
    circuit.hidden = !state.reportConfirmed || !state.coupler;
    byId('coolingInstructions').textContent = state.coolingRestored ? '回路已锁定，备用冷却正在运行。'
      : !state.reportConfirmed ? '设备停机。先在安全终端查阅事故报告。'
        : !state.coupler ? '耦合器缺失。到维修柜取件后返回这里。'
          : '耦合器已装入。旋转管段，让左上入口与右下出口连通，再执行试压。';
    byId('askAlignment').hidden = !canEchoAct(state, 'align_pipe');
    byId('askScan').hidden = !state.coolingRestored || state.passageSafe || (state.scannedA && state.scannedB);
    routeForm.hidden = !state.coolingRestored;
    byId('passageInstructions').textContent = state.coolingRestored
      ? '选择同时符合三项标准的通道。压差 ≤ ' + PRESSURE_LIMIT + '，颗粒指数 ≤ ' + PARTICLE_LIMIT + '，门锁联锁必须响应。'
      : '检测台等待稳定冷却。恢复后，请 ECHO 扫描并上传通道读数。';
    for (const radio of routeOptions.querySelectorAll('input')) {
      const scanned = state[SCAN_FIELDS[radio.value]];
      radio.disabled = !scanned || state.passageSafe;
      const readings = incident.routes[radio.value];
      radio.parentElement.querySelector('[data-reading]').textContent = scanned
        ? '压差 ' + readings.pressure + ' · 颗粒指数 ' + readings.particles + ' · 联锁' + (readings.interlock ? '响应' : '无响应')
        : '等待 ECHO 扫描';
    }
    submit.disabled = state.passageSafe || !new FormData(routeForm).get('route');
  }

  restart.addEventListener('click', restoreTiles);
  test.addEventListener('click', () => {
    const state = getState();
    if (!state.reportConfirmed || !state.coupler || state.coolingRestored) return;
    trial = traceCircuit(tiles);
    if (trial.connected) {
      state.coolingRestored = true;
      notice('coolingNotice', FLOW_RESULT);
      feedback('备用冷却已恢复。到出口检测台核对通道读数。');
      render();
    } else {
      const row = Math.floor(trial.leak / GRID_SIZE) + 1;
      const column = trial.leak % GRID_SIZE + 1;
      notice('coolingNotice', '试压未通过。检查第 ' + row + ' 行第 ' + column + ' 列附近的管段接口。', true);
    }
    renderPipes();
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
    notice('passageNotice', route + ' 通道通过检测。用实测结果向 ECHO 申请撤离。');
    feedback(route + ' 通道通过检测。按 Q 联系 ECHO。');
    render();
  });

  return {
    render: renderDevices,
    align() {
      if (traceCircuit(tiles).connected) return '当前回路已连通，可以直接试压。';
      adjusted = alignNextPipe(tiles);
      if (adjusted === null) return '管路已对齐，可以执行试压。';
      calibration = {index: adjusted, ports: tiles[adjusted]};
      getState().alignedPipe = true;
      trial = undefined;
      const result = 'ECHO 已校准第 ' + (Math.floor(adjusted / GRID_SIZE) + 1) + ' 行第 ' +
        (adjusted % GRID_SIZE + 1) + ' 列。其余管段由你查验。';
      notice('coolingNotice', result);
      renderPipes();
      return result;
    },
    reset(nextIncident) {
      incident = nextIncident;
      calibration = undefined;
      buttons = incident.tiles.map((_, index) => {
        const button = document.createElement('button');
        button.className = 'pipe-tile';
        button.type = 'button';
        button.addEventListener('click', () => {
          tiles[index] = rotatePipe(tiles[index]);
          trial = undefined;
          if (adjusted === index) adjusted = undefined;
          notice('coolingNotice');
          renderPipes();
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
