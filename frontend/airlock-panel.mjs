import {locale, localText} from './ui-language.mjs';
import {airlockDisplay, AIRLOCK_ACTIONS, enterChamber, finishClosing, leaveChamber} from '../shared/airlock.mjs';

const byId = id => document.getElementById(id);
const doorLabels = {
  outside: '内门待进入 · 外门锁定',
  closing: '黄灯 · 内门正在关闭',
  closed: '绿灯 · 内门已关严',
  rejected: '红灯 · 联锁拒绝切电',
  open: '绿灯 · 外门已打开'
};
const closingTime = 2200;

export function createAirlockPanel(getState, publish) {
  const sparesForm = byId('sparesForm');
  const sparesCode = byId('sparesCode');
  const sparesNotice = byId('sparesNotice');
  let cabinetCode;
  let closingDeadline;

  function render() {
    const state = getState();
    const {authorized, phase, spare, sensor, schedule} = state.airlock;
    byId('passageCheck').hidden = authorized;
    byId('airlockPanel').hidden = !authorized || byId('echoDialog').dataset.console !== 'airlock';
    byId('airlockLog').hidden = !authorized;
    const {innerClosed, outerOpen} = airlockDisplay(phase);
    byId('innerDoor').dataset.state = innerClosed ? 'closed' : phase;
    byId('outerDoor').dataset.state = outerOpen ? 'open' : 'locked';
    localText(byId('innerDoorState'), innerClosed ? '已关严' : phase === 'closing' ? '关闭中' : phase === 'rejected' ? '未关严' : '待进入');
    localText(byId('outerDoorState'), outerOpen ? '已打开' : '锁定');
    localText(byId('airlockSensor'), sensor
      ? '门位传感器在线。ECHO 能读取内门状态。'
      : '门位传感器离线。现场联锁灯仍可观察，备件可在维修柜取得。');
    byId('airlockDoorDisplay').dataset.phase = phase;
    const doorStatus = byId('airlockDoorStatus');
    localText(doorStatus, doorLabels[phase]);
    const scheduleStatus = byId('airlockSchedule');
    scheduleStatus.hidden = !schedule;
    localText(scheduleStatus, schedule === AIRLOCK_ACTIONS.onEntry ? '已登记。进舱时切电。' : '已登记。等待内门关严。');
    byId('enterChamber').hidden = phase !== 'outside';
    byId('leaveChamber').hidden = phase === 'outside' || phase === 'open';
    byId('installSensor').hidden = !spare || sensor || phase !== 'outside';
    byId('airlockWalkOut').hidden = phase !== 'open';
    sparesForm.hidden = spare;
  }

  sparesForm.addEventListener('submit', event => {
    event.preventDefault();
    const state = getState();
    if (!state.coupler || state.airlock.spare) return;
    const correct = sparesCode.value === cabinetCode;
    sparesNotice.hidden = false;
    sparesNotice.dataset.error = String(!correct);
    const notice = correct ? '已取得门位传感器。可在出口缓冲舱安装。' : '密码不符。检查实验顺序和柜门贴纸。';
    localText(sparesNotice, notice);
    if (!correct) return sparesCode.select();
    state.airlock.spare = true;
    publish(notice);
  });

  byId('installSensor').addEventListener('click', () => {
    const airlock = getState().airlock;
    if (!airlock.spare || airlock.sensor || airlock.phase !== 'outside') return;
    airlock.sensor = true;
    publish('门位传感器已安装。ECHO 现在能判断内门何时关严。');
  });

  byId('enterChamber').addEventListener('click', () => {
    const state = getState();
    const outcome = enterChamber(state, locale());
    if (state.airlock.phase === 'closing') closingDeadline = performance.now() + closingTime;
    if (outcome) publish(outcome);
  });

  byId('leaveChamber').addEventListener('click', () => {
    const outcome = leaveChamber(getState().airlock, locale());
    if (!outcome) return;
    closingDeadline = undefined;
    publish(outcome);
  });

  return {
    render,
    update(time) {
      if (closingDeadline === undefined || time < closingDeadline) return;
      closingDeadline = undefined;
      const outcome = finishClosing(getState(), locale());
      if (outcome) publish(outcome);
    },
    reset(incident) {
      cabinetCode = [...incident.digits].reverse().join('');
      closingDeadline = undefined;
      sparesForm.reset();
      sparesNotice.hidden = true;
      byId('airlockLog').open = false;
    }
  };
}
