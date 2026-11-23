import {ROOM_PROPS} from './room.mjs';
import {drawPropPreview} from './pixel-art.mjs';
import {localText} from './ui-language.mjs';

const descriptions = {
  microscope: '载玻片上是一颗干涸的盐水滴。研究员把盐晶体拍下来，当成了自己的桌面背景。',
  intercom: '旧的值班广播还在循环列表里。「夜班同事辛苦了。离开时请记得拿走门口的伞。」',
  photo: '照片背面写着「试运行第一天」。这天 ECHO 学会了在合影倒数到零之后说“茄子”。',
  coffee: '贴纸上写着「喝完记得洗杯子」。下方有人补了一句「ECHO 也算值班人员」。',
  lights: '照明面板还能切换走廊灯。暖色灯原本是夜班留下的设置。'
};

const switches = {
  microscope: {labels: ['切换到紫光', '切换到白光'], notices: ['白光下能看见晶体的棱角。', '紫光下，盐晶体边缘泛起淡紫色。']},
  coffee: {labels: ['冲一杯咖啡', '喝掉咖啡'], notices: ['杯子空了。', '刚冲好的咖啡还冒着热气。']},
  lights: {labels: ['切换到暖光', '切换到冷光'], notices: ['走廊切换到冷光。', '走廊切换到暖光。']}
};

export function createRoomProps(openPanel, onEvidenceFound) {
  const panel = document.getElementById('propDialog');
  const title = document.getElementById('propTitle');
  const description = document.getElementById('propDescription');
  const status = document.getElementById('propStatus');
  const action = document.getElementById('propAction');
  const preview = document.getElementById('propPreview');
  const shiftLog = document.getElementById('propShiftLog');
  let selected;
  let active = {};
  let broadcastStatus;
  let audio;
  let playingUntil = 0;

  function render() {
    localText(title, ROOM_PROPS[selected].title);
    localText(description, descriptions[selected]);
    const control = switches[selected];
    const on = Number(Boolean(active[selected]));
    const notice = selected === 'intercom' ? broadcastStatus : control?.notices[on];
    status.hidden = !notice;
    localText(status, notice ?? '');
    action.hidden = selected === 'photo';
    shiftLog.hidden = selected !== 'coffee';
    localText(action, control ? control.labels[on] : '播放提示音');
    drawPropPreview(preview, selected, Boolean(on));
  }

  shiftLog.addEventListener('toggle', () => {
    if (!shiftLog.open || selected !== 'coffee' || active.shiftLog) return;
    active.shiftLog = true;
    onEvidenceFound();
  });

  async function playChime() {
    audio ??= new AudioContext();
    if (audio.state !== 'running') await audio.resume();
    const start = audio.currentTime;
    if (start < playingUntil) return;
    playingUntil = start + .53;
    for (const [index, frequency] of [392, 494, 587].entries()) {
      const note = audio.createOscillator();
      const volume = audio.createGain();
      const time = start + index * .14;
      note.frequency.value = frequency;
      volume.gain.setValueAtTime(0, time);
      volume.gain.linearRampToValueAtTime(.06, time + .03);
      volume.gain.linearRampToValueAtTime(0, time + .22);
      note.connect(volume).connect(audio.destination);
      note.start(time);
      note.stop(time + .23);
    }
  }

  action.addEventListener('click', async () => {
    if (selected === 'intercom') {
      const session = active;
      let notice;
      try {
        await playChime();
        notice = '广播台播放了三声提示音。';
      } catch {
        notice = '当前无法播放提示音。值班广播的文字仍可读。';
      }
      if (active !== session) return;
      active.intercom = true;
      broadcastStatus = notice;
      if (selected === 'intercom') render();
      return;
    }
    active[selected] = !active[selected];
    if (selected === 'coffee' && active.coffee) active.brewedCoffee = true;
    render();
  });

  return {
    get active() { return active; },
    open(id) {
      selected = id;
      render();
      openPanel(panel);
    },
    reset() {
      active = {};
      shiftLog.open = false;
      broadcastStatus = undefined;
    }
  };
}
