import {phrase} from '../shared/i18n.mjs';
import {hasPressureBoundary, PASSAGE_STANDARDS} from '../shared/passage-standards.mjs';
import {PARTICLE_LIMIT, PRESSURE_LIMIT} from '../shared/puzzles.mjs';
import {OBJECTS, REPORT_FRAGMENTS, ROOMS} from '../shared/room.mjs';
import {drawPropPreview} from './pixel-art.mjs';
import {localText, t} from './ui-language.mjs';

function drawTrialPhoto(canvas, frame) {
  const ctx = canvas.getContext('2d');
  function fill(color, x, y, width, height) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width, height);
  }

  fill('#253944', 0, 0, 120, 68);
  fill('#17262d', 0, 48, 120, 20);
  fill('#4b626a', 0, 12, 120, 3);
  fill('#809197', 12, 15, 53, 39);
  fill('#15232a', 16, 19, 45, 32);
  const gap = frame === 0 ? 8 : 0;
  fill('#121e24', 17, 20, 43, 30);
  fill('#435c66', 17, 20, 22 - gap, 30);
  fill('#516b75', 39 + gap, 20, 21 - gap, 30);
  fill('#caab63', 18, 53, 41, 2);
  fill('#5b7078', 76, 22, 35, 30);
  fill('#1b3038', 79, 25, 29, 21);
  const lamp = ['#74858a', '#ffd38a', '#79e7bc'][frame];
  fill(lamp, 82, 28, 4, 4);
  if (frame === 2) {
    fill(lamp, 91, 35, 3, 3);
    fill(lamp, 94, 38, 3, 3);
    fill(lamp, 97, 35, 3, 3);
    fill(lamp, 100, 32, 3, 3);
  } else {
    for (let x = 90; x <= 102; x += 6) fill(lamp, x, 37, 2, 2);
  }
  fill('#101a1f', 0, 0, 120, 2);
  fill('#101a1f', 0, 66, 120, 2);
}

const descriptions = {
  microscope: '载玻片上是一颗干涸的盐水滴。研究员把盐晶体拍下来，当成了自己的桌面背景。',
  intercom: '旧的值班广播还在循环列表里。「夜班同事辛苦了。离开时请记得拿走门口的伞。」',
  photo: '照片背面写着「试运行第一天」。这天 ECHO 学会了在合影倒数到零之后说“茄子”。',
  coffee: '贴纸上写着「喝完记得洗杯子」。下方有人补了一句「ECHO 也算值班人员」。',
  inspectionBox: '盒盖内侧夹着一张旧便签，只有上限一栏磨损严重。',
  lights: '照明面板还能切换走廊灯。暖色灯原本是夜班留下的设置。'
};

const switches = {
  microscope: {labels: ['切换到紫光', '切换到白光'], notices: ['白光下能看见晶体的棱角。', '紫光下，盐晶体边缘泛起淡紫色。']},
  coffee: {labels: ['冲一杯咖啡', '喝掉咖啡'], notices: ['杯子空了。', '刚冲好的咖啡还冒着热气。']},
  lights: {labels: ['切换到暖光', '切换到冷光'], notices: ['走廊切换到冷光。', '走廊切换到暖光。']}
};

export function createRoomProps(openPanel, onEvidenceFound, getStandards) {
  const panel = document.getElementById('propDialog');
  const title = document.getElementById('propTitle');
  const description = document.getElementById('propDescription');
  const status = document.getElementById('propStatus');
  const action = document.getElementById('propAction');
  const inspectionNote = document.getElementById('inspectionNote');
  const preview = document.getElementById('propPreview');
  const shiftLog = document.getElementById('propShiftLog');
  const controls = document.getElementById('microscopeControls');
  const view = document.getElementById('microscopeView');
  const near = document.getElementById('focusNear');
  const far = document.getElementById('focusFar');
  const countForm = document.getElementById('microscopeCount');
  const count = document.getElementById('particleCount');
  const result = document.getElementById('microscopeResult');
  const movement = document.getElementById('microscopeMovement');
  const moves = {up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0]};
  const randomInt = size => Math.floor(Math.random() * size);
  let frame;
  let reference;
  let sample;
  let feedback;
  const lensPositions = 6;
  const startFocus = Math.floor(lensPositions / 2);
  const targetFocus = 0;
  let focus = startFocus;
  let lastCount = null;
  let selected;
  let active = {};
  let broadcastStatus;
  let audio;
  let playingUntil = 0;

  function renderSample() {
    const focusError = Math.abs(focus - targetFocus);
    const sharp = focusError === 0;
    const ctx = preview.getContext('2d');
    ctx.fillStyle = '#201b39';
    ctx.fillRect(0, 0, 96, 48);
    ctx.fillStyle = '#ffce73';
    const referenceX = reference % 3 * 32;
    const referenceY = Math.floor(reference / 3) * 16;
    ctx.fillRect(referenceX + 1, referenceY + 1, 8, 2);
    ctx.fillRect(referenceX + 1, referenceY + 1, 2, 6);
    ctx.save();
    if (!sharp) ctx.filter = `blur(${.45 + focusError * .25}px)`;
    ctx.fillStyle = ctx.strokeStyle = '#e8bcff';
    for (const {x, y, solid} of sample) {
      if (solid) ctx.fillRect(x - 1, y - 1, 3, 3);
      else ctx.strokeRect(x - .5, y - .5, 2, 2);
    }
    ctx.restore();
    ctx.strokeStyle = '#d2b8ff';
    ctx.strokeRect(frame.x * 32 + .5, frame.y * 16 + .5, 31, 15);
    near.disabled = focus === 0;
    far.disabled = focus === lensPositions - 1;
    for (const button of movement.querySelectorAll('button')) {
      const [dx, dy] = moves[button.dataset.moveFrame];
      button.disabled = !canMove(dx, dy);
    }
    localText(view, !sharp ? focusError === 1 ? '边缘略虚，已接近清晰焦点。'
      : focusError <= 3 ? '能辨认轮廓，边缘仍模糊。' : '亮点明显发散，继续调焦。'
      : aligned() ? '视野清晰，计数框已对齐参照区。' : '视野清晰。寻找金色角标。');
    const sampleDescription = document.getElementById('microscopeSampleDescription');
    localText(sampleDescription, phrase('计数框在第 {row} 行第 {col} 列。角标在第 {refRow} 行第 {refCol} 列。', {
      row: frame.y + 1, col: frame.x + 1, refRow: Math.floor(reference / 3) + 1, refCol: reference % 3 + 1
    }));
    const contents = document.getElementById('microscopeSampleContents');
    contents.hidden = !sharp || !aligned();
    localText(contents, '参照区内从上到下：实心颗粒、空心气泡、实心颗粒、空心气泡。');
    const collected = getStandards().microscope;
    countForm.hidden = Boolean(collected);
    result.hidden = !collected && !feedback;
    result.dataset.error = String(!collected);
    if (!result.hidden) localText(result, collected ? PASSAGE_STANDARDS.microscope.reading : feedback);
  }

  function aligned() {
    return frame.y * 3 + frame.x === reference;
  }

  function canMove(dx, dy) {
    return frame.x + dx >= 0 && frame.x + dx < 3 && frame.y + dy >= 0 && frame.y + dy < 3;
  }

  function moveFrame(direction) {
    const [dx, dy] = moves[direction];
    if (!canMove(dx, dy)) return;
    frame.x += dx;
    frame.y += dy;
    renderSample();
  }

  movement.addEventListener('click', event => {
    const direction = event.target.closest('[data-move-frame]')?.dataset.moveFrame;
    if (direction) moveFrame(direction);
  });

  panel.addEventListener('keydown', event => {
    const direction = event.key.startsWith('Arrow') && event.key.slice(5).toLowerCase();
    if (controls.hidden || !Object.hasOwn(moves, direction) || count.contains(event.target)) return;
    event.preventDefault();
    moveFrame(direction);
  });

  near.addEventListener('click', () => {
    focus -= 1;
    renderSample();
  });
  far.addEventListener('click', () => {
    focus += 1;
    renderSample();
  });
  countForm.addEventListener('submit', event => {
    event.preventDefault();
    if (selected !== 'microscope' || !active.microscope || getStandards().microscope) return;
    if (!aligned()) feedback = '计数框未对齐参照区。请寻找金色角标。';
    else if (focus !== targetFocus) feedback = '请先调焦，直到颗粒边缘清晰。';
    else {
      lastCount = Number(new FormData(countForm).get('particleCount'));
      if (lastCount === PARTICLE_LIMIT) {
        getStandards().microscope = true;
        onEvidenceFound();
      } else feedback = '读数未通过。再检查计数框边界和颗粒形状。';
    }
    renderSample();
  });

  const photoSheet = document.getElementById('photoContactSheet');
  const photoMonitor = document.getElementById('photoMonitor');
  const photoCanvas = photoMonitor.querySelector('canvas');
  const photoDoor = document.getElementById('photoDoorEvidence');
  const photoReceipt = document.getElementById('photoReceiptEvidence');
  const photoConclusion = document.getElementById('photoConclusion');
  const photoSubmit = photoConclusion.querySelector('button[type=submit]');
  const photoInterpretation = document.getElementById('photoJudgment');
  const photoChoices = document.getElementById('photoChoices');
  const photoChoiceTrigger = photoChoices.querySelector('summary');
  const photoSelectedChoice = document.getElementById('photoSelectedChoice');
  const photoChoiceLabels = {
    door: '只要看到内门关严',
    sent: '只要测试请求已经发出',
    response: '必须收到门锁联锁的响应'
  };
  const photoChoice = () => photoInterpretation.querySelector('input:checked')?.value;

  function renderPhotoChoice() {
    localText(photoSelectedChoice, photoChoiceLabels[photoChoice()] ?? '选择你的判断');
  }

  function closePhotoChoices() {
    photoChoiceTrigger.focus();
    photoChoices.open = false;
  }

  photoChoices.addEventListener('change', () => {
    renderPhotoChoice();
    closePhotoChoices();
  });
  panel.addEventListener('click', event => {
    if (!photoChoices.contains(event.target)) photoChoices.open = false;
  });
  photoChoices.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !photoChoices.open) return;
    event.preventDefault();
    event.stopPropagation();
    closePhotoChoices();
  });
  photoConclusion.addEventListener('invalid', event => {
    event.preventDefault();
    photoChoices.open = true;
    event.target.focus();
  }, true);

  let receiptInspected = false;
  const photoResult = document.getElementById('photoResult');
  const photoFrames = [...photoSheet.querySelectorAll('[data-photo-frame]')];
  const photoRecords = [
    {door: '内门：仍有门缝，尚未关严', receipt: '回执：等待信号'},
    {door: '内门：已关严', receipt: '回执：请求已发出，尚未收到回复'},
    {door: '内门：已关严', receipt: '回执：联锁响应', passed: true}
  ];
  let photoFrame = null;
  let photoFeedback;

  function renderPhoto() {
    const record = photoRecords[photoFrame];
    const collected = getStandards().photo;
    photoMonitor.hidden = !record;
    for (const button of photoFrames) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.photoFrame) === photoFrame));
    }
    if (record) {
      drawTrialPhoto(photoCanvas, photoFrame);
      for (const [button, description] of [[photoDoor, record.door], [photoReceipt, record.receipt]]) {
        button.setAttribute('aria-label', t(description));
        button.title = t(description);
      }
    }
    photoSubmit.disabled = Boolean(collected) || !record;
    photoInterpretation.disabled = Boolean(collected);
    renderPhotoChoice();
    photoResult.hidden = !collected && !photoFeedback;
    if (!photoResult.hidden) localText(photoResult, photoFeedback ?? '线索已记录：门锁联锁必须响应。');
  }

  for (const button of photoFrames) {
    drawTrialPhoto(button.querySelector('canvas'), Number(button.dataset.photoFrame));
    button.addEventListener('click', () => {
      photoFrame = Number(button.dataset.photoFrame);
      receiptInspected = false;
      photoConclusion.reset();
      photoChoices.open = false;
      photoFeedback = undefined;
      renderPhoto();
    });
  }
  photoDoor.addEventListener('click', () => {
    photoFeedback = photoRecords[photoFrame]?.door;
    renderPhoto();
  });
  photoReceipt.addEventListener('click', () => {
    receiptInspected = true;
    photoFeedback = photoRecords[photoFrame]?.receipt;
    renderPhoto();
  });
  photoConclusion.addEventListener('submit', event => {
    event.preventDefault();
    const record = photoRecords[photoFrame];
    if (selected !== 'photo' || !record || getStandards().photo) return;
    if (!receiptInspected) {
      photoFeedback = '请先点击照片右侧的联锁面板，查看回执后再提交。';
    } else if (!record.passed) {
      photoFeedback = '这条记录还没有收到响应。请找一张有实际回执的照片。';
    } else if (photoChoice() !== 'response') {
      photoFeedback = '再比较门位、发送请求和收到响应分别能证明什么。';
    } else {
      getStandards().photo = true;
      photoFeedback = undefined;
      onEvidenceFound();
    }
    renderPhoto();
  });
  const gauge = document.getElementById('pressureGauge');
  const dial = document.getElementById('gaugeDial');
  const zeroMode = document.getElementById('gaugeZeroMode');
  const referenceMode = document.getElementById('gaugeReferenceMode');
  const decrease = document.getElementById('gaugeDecrease');
  const increase = document.getElementById('gaugeIncrease');
  const gaugeTestControls = document.getElementById('gaugeTestControls');
  const gaugeResults = document.getElementById('gaugeTestResults');
  const confirmZero = document.getElementById('gaugeConfirmZero');
  const testedSteps = new Set();
  let testStep;
  let gaugeNoteFound;
  const gaugeNotice = document.getElementById('gaugeFeedback');
  const minTick = -4;
  const maxTick = 6;
  let gaugeMode;
  let needleOffset;
  let gaugeCalibrated;
  let gaugeFeedback;

  function drawGauge(reading) {
    const ctx = dial.getContext('2d');
    const angle = tick => Math.PI * (1 + (tick - minTick) / (maxTick - minTick));
    ctx.fillStyle = '#182932';
    ctx.fillRect(0, 0, 144, 90);
    ctx.fillStyle = '#dbe5db';
    ctx.fillRect(4, 4, 136, 80);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '8px monospace';

    function point(theta, radius) {
      return [72 + radius * Math.cos(theta), 72 + radius * Math.sin(theta)];
    }

    function line(from, to, color, width) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(...from);
      ctx.lineTo(...to);
      ctx.stroke();
    }

    for (let tick = minTick; tick <= maxTick; tick++) {
      const theta = angle(tick);
      line(point(theta, 46), point(theta, 51), '#253a40', tick === 0 ? 2 : 1);
      ctx.fillStyle = '#253a40';
      ctx.fillText(String(tick), ...point(theta, 59));
    }
    if (reading !== null) line([72, 72], point(angle(reading), 45), '#9c3324', 2);
    ctx.fillStyle = '#253a40';
    ctx.fillRect(69, 69, 6, 6);
    dial.setAttribute('aria-label', t(reading === null ? '压差表待启动' : phrase('压差表指向 {reading}', {reading})));
  }

  function renderGauge() {
    const collected = getStandards().lights;
    const testing = gaugeMode === 'reference' && !collected;
    const adjusting = gaugeMode === 'zero' && !gaugeCalibrated;
    const reading = gaugeMode === 'reference' ? testStep : gaugeMode === 'zero' ? needleOffset : null;
    zeroMode.setAttribute('aria-pressed', String(gaugeMode === 'zero'));
    referenceMode.setAttribute('aria-pressed', String(gaugeMode === 'reference'));
    referenceMode.disabled = !gaugeCalibrated || !gaugeNoteFound;
    document.getElementById('gaugeAdjustments').hidden = !adjusting && !testing;
    confirmZero.hidden = !adjusting;
    decrease.disabled = reading === minTick;
    increase.disabled = reading === maxTick;
    gaugeTestControls.hidden = !testing;
    if (testing) {
      const tested = testedSteps.has(testStep);
      const result = testStep < 0 ? 'reverse' : testStep <= PRESSURE_LIMIT ? 'pass' : 'rejected';
      const labels = {
        reverse: '{tick} 档 · 反向读数',
        pass: '{tick} 档 · 通过',
        rejected: '{tick} 档 · 拒绝'
      };
      gaugeResults.dataset.result = tested ? result : 'pending';
      localText(gaugeResults, tested ? phrase(labels[result], {tick: testStep}) : '当前档待测试');
    }
    localText(document.getElementById('gaugeInstructions'), gaugeMode === 'reference'
      ? hasPressureBoundary({calibrated: gaugeCalibrated, noteFound: gaugeNoteFound, tested: [...testedSteps]})
        ? '实测记录齐全。可以请 ECHO 确认测试结果。'
        : '逐档测试，找到相邻的通过档与拒绝档，再向 ECHO 报告结论。'
      : gaugeCalibrated ? gaugeNoteFound ? '从便签指定的档位开始测试。' : '校零完成。可联系 ECHO 了解下一步。'
        : gaugeMode === 'zero' ? '等压时表针应归零。' : '先切到校零档，接通内部等压回路。');
    drawGauge(reading);
    gaugeNotice.hidden = !collected && !gaugeFeedback;
    if (!gaugeNotice.hidden) localText(gaugeNotice, collected
      ? phrase('线索已记录：撤离通道压差 ≤ {limit}。', {limit: PRESSURE_LIMIT}) : gaugeFeedback);
  }

  for (const [button, mode] of [[zeroMode, 'zero'], [referenceMode, 'reference']]) {
    button.addEventListener('click', () => {
      gaugeMode = mode;
      gaugeFeedback = undefined;
      renderGauge();
    });
  }
  for (const [button, step] of [[decrease, -1], [increase, 1]]) {
    button.addEventListener('click', () => {
      const reading = gaugeMode === 'reference' ? testStep : needleOffset;
      if (reading + step < minTick || reading + step > maxTick) return;
      if (gaugeMode === 'reference') testStep += step;
      else needleOffset += step;
      gaugeFeedback = undefined;
      renderGauge();
    });
  }
  confirmZero.addEventListener('click', () => {
    gaugeCalibrated = needleOffset === 0;
    gaugeFeedback = gaugeCalibrated ? undefined : '校零未通过。把表针对准零刻度。';
    renderGauge();
  });
  document.getElementById('gaugeRunTest').addEventListener('click', () => {
    if (gaugeMode !== 'reference' || !gaugeCalibrated || !gaugeNoteFound || getStandards().lights) return;
    testedSteps.add(testStep);
    renderGauge();
  });

  function render() {
    const inspectingBox = selected === 'inspectionBox';
    inspectionNote.hidden = !inspectingBox;
    preview.hidden = inspectingBox;
    localText(title, OBJECTS[selected].title);
    localText(description, descriptions[selected]);
    const control = switches[selected];
    const on = Number(Boolean(active[selected]));
    const notice = selected === 'intercom' ? broadcastStatus : control?.notices[on];
    status.hidden = !notice;
    localText(status, notice ?? '');
    action.hidden = selected === 'photo' || selected === 'inspectionBox';
    shiftLog.hidden = selected !== 'coffee';
    localText(action, control ? control.labels[on] : '播放提示音');
    photoSheet.hidden = selected !== 'photo';
    if (!photoSheet.hidden) renderPhoto();
    gauge.hidden = selected !== 'lights';
    if (!gauge.hidden) renderGauge();
    controls.hidden = selected !== 'microscope' || !on;
    if (!controls.hidden) renderSample();
    else if (!inspectingBox) drawPropPreview(preview, selected, Boolean(on));
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
    recordGaugeCriterion() {
      if (!hasPressureBoundary(this.gaugeContext()) || getStandards().lights) return;
      getStandards().lights = true;
      onEvidenceFound();
      return phrase('线索已记录：撤离通道压差 ≤ {limit}。', {limit: PRESSURE_LIMIT});
    },
    gaugeContext() {
      return {mode: gaugeMode, calibrated: gaugeCalibrated, noteFound: gaugeNoteFound, tested: [...testedSteps], offset: gaugeMode === 'zero' ? needleOffset : null};
    },
    photoContext() {
      return {frame: photoFrame === null ? null : photoFrame + 1, attempted: Boolean(photoFeedback), receiptInspected};
    },
    microscopeContext() {
      return {violet: Boolean(active.microscope), focused: focus === targetFocus, aligned: aligned(), lastCount};
    },
    get active() { return active; },
    get echoContext() {
      if (selected === 'microscope' || selected === 'photo' && photoSheet.open ||
          selected === 'lights' && gauge.open) return selected;
    },
    open(id) {
      selected = id;
      if (id === 'inspectionBox') gaugeNoteFound = true;
      render();
      openPanel(panel);
    },
    reset() {
      active = {};
      gaugeMode = null;
      needleOffset = (randomInt(2) + 2) * (randomInt(2) ? 1 : -1);
      gaugeCalibrated = false;
      gaugeFeedback = undefined;
      gauge.open = false;
      gaugeNoteFound = false;
      testStep = 0;
      testedSteps.clear();
      focus = startFocus;
      frame = {x: 1, y: 1};
      reference = randomInt(8);
      if (reference >= 4) reference += 1;
      sample = Array.from({length: 9}, (_, cell) => {
        const referenceCell = cell === reference;
        const slots = [4, 11, 19, 26];
        return slots.map((slot, index) => ({
          x: cell % 3 * 32 + slot + randomInt(3),
          y: Math.floor(cell / 3) * 16 + (referenceCell ? 4 + index * 3 : 5 + randomInt(7)),
          solid: referenceCell ? index % 2 === 0 : randomInt(2) === 0
        }));
      }).flat();
      feedback = undefined;
      lastCount = null;
      countForm.reset();
      photoFrame = null;
      receiptInspected = false;
      photoConclusion.reset();
      photoChoices.open = false;
      photoFeedback = undefined;
      photoSheet.open = false;
      shiftLog.open = false;
      broadcastStatus = undefined;
    }
  };
}

const fragmentIds = Object.keys(REPORT_FRAGMENTS);
// Each layer clips the same text layout. Shared edges use the same vertices in reverse.
const cuts = [
  '0 0, 47% 0, 47% 15%, 54% 15%, 54% 32%, 50% 32%, 50% 50%, 32% 50%, 32% 44%, 16% 44%, 16% 54%, 0 54%',
  '47% 0, 100% 0, 100% 46%, 84% 46%, 84% 56%, 68% 56%, 68% 50%, 50% 50%, 50% 32%, 54% 32%, 54% 15%, 47% 15%',
  '0 54%, 16% 54%, 16% 44%, 32% 44%, 32% 50%, 50% 50%, 50% 67%, 44% 67%, 44% 83%, 53% 83%, 53% 100%, 0 100%',
  '50% 50%, 68% 50%, 68% 56%, 84% 56%, 84% 46%, 100% 46%, 100% 100%, 53% 100%, 53% 83%, 44% 83%, 44% 67%, 50% 67%'
];

export function createReportFragments(getState, getReport, onAssembled) {
  const byId = id => document.getElementById(id);
  const locations = byId('reportFragmentLocations');
  const assembly = byId('reportAssembly');
  const board = byId('reportBoard');
  const tray = byId('reportTray');
  const status = byId('reportAssemblyStatus');
  const help = byId('reportAssemblyHelp');
  const completedPaper = byId('reportText');
  const preview = byId('reportFragmentPreview');
  const placed = new Set();
  const trayOrder = [2, 0, 3, 1];
  let selected;
  let previewIndex;
  let drag;

  function paper(index) {
    const layer = document.createElement('span');
    layer.className = 'report-paper';
    layer.style.setProperty('--paper-x', index % 2 === 0 ? '0%' : '-100%');
    layer.style.setProperty('--paper-y', index < 2 ? '0%' : '-100%');
    layer.style.clipPath = `polygon(${cuts[index]})`;
    layer.setAttribute('aria-hidden', 'true');
    return layer;
  }

  function tile() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'report-tile';
    return button;
  }

  const pieces = fragmentIds.map((_, index) => {
    const button = tile();
    button.append(paper(index));
    button.addEventListener('click', () => select(index));
    button.addEventListener('pointerdown', event => beginDrag(event, index));
    return button;
  });
  const slots = fragmentIds.map((_, index) => {
    const button = tile();
    button.classList.add('report-slot');
    button.addEventListener('click', () => place(index));
    return button;
  });
  const entries = fragmentIds.map(() => document.createElement('li'));
  locations.append(...entries);
  board.append(...slots);
  tray.append(...trayOrder.map(index => pieces[index]));

  function select(index) {
    selected = index;
    for (const [i, piece] of pieces.entries()) piece.setAttribute('aria-pressed', String(i === selected));
  }

  function place(index) {
    if (selected === undefined || placed.has(index)) return;
    if (index !== selected) {
      localText(status, '纸边对不上，试试底板上的其他位置。');
      return;
    }

    placed.add(index);
    slots[index].append(pieces[index].firstElementChild);
    slots[index].disabled = true;
    pieces[index].style.visibility = 'hidden';
    select(undefined);
    localText(status, phrase('已拼接 {count} / {total}', {count: placed.size, total: fragmentIds.length}));
    if (placed.size === fragmentIds.length) onAssembled();
    else pieces[trayOrder.find(i => !placed.has(i))].focus();
  }

  function beginDrag(event, index) {
    if (!event.isPrimary || event.button !== 0) return;
    const piece = pieces[index];
    const {clientX, clientY, pointerId} = event;
    const bounds = piece.getBoundingClientRect();
    piece.setPointerCapture(pointerId);
    drag = {piece, index, clientX, clientY, bounds, pointerId, moved: false};
  }

  tray.addEventListener('pointermove', event => {
    if (drag?.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.clientX;
    const dy = event.clientY - drag.clientY;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    drag.piece.classList.add('is-dragging');
    drag.piece.style.transform = `translate(${dx}px, ${dy}px)`;
  });

  function endDrag(event, cancelled = false) {
    if (drag?.pointerId !== event.pointerId) return;
    const {piece, index, bounds, moved, clientX, clientY} = drag;
    drag = undefined;
    piece.classList.remove('is-dragging');
    piece.style.transform = '';
    if (!moved || cancelled) return;
    const x = bounds.left + bounds.width / 2 + event.clientX - clientX;
    const y = bounds.top + bounds.height / 2 + event.clientY - clientY;
    const slot = slots.findIndex(tile => {
      const rect = tile.getBoundingClientRect();
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    });
    select(index);
    if (slot !== -1) place(slot);
  }

  tray.addEventListener('pointerup', event => endDrag(event));
  tray.addEventListener('pointercancel', event => endDrag(event, true));

  function render() {
    const state = getState();
    assembly.hidden = !state.reportOpen && state.reportFragments.length < fragmentIds.length;
    locations.hidden = help.hidden = tray.hidden = status.hidden = state.reportOpen;
    completedPaper.hidden = !state.reportOpen;
    const report = getReport();
    completedPaper.textContent = report;
    for (const [index, key] of fragmentIds.entries()) {
      const collected = state.reportFragments.includes(key);
      const room = t(ROOMS[REPORT_FRAGMENTS[key].room].name);
      localText(entries[index], phrase(collected ? '{room} · 已拾取' : '{room} · 待找回', {room}));
      pieces[index].setAttribute('aria-label', t(phrase('残页 · {room}', {room})));
      slots[index].setAttribute('aria-label', t(phrase('底板位置 {position}', {position: index + 1})));
      slots[index].hidden = state.reportOpen;
      (placed.has(index) ? slots[index] : pieces[index]).firstElementChild.textContent = report;
    }
    if (previewIndex !== undefined) preview.firstElementChild.firstElementChild.textContent = report;
  }

  return {
    render,
    preview(key) {
      previewIndex = fragmentIds.indexOf(key);
      const wrapper = document.createElement('div');
      wrapper.className = 'report-tile';
      wrapper.append(paper(previewIndex));
      preview.replaceChildren(wrapper);
      render();
    },
    reset() {
      for (const index of placed) {
        pieces[index].append(slots[index].firstElementChild);
        slots[index].disabled = false;
        pieces[index].style.visibility = '';
      }
      placed.clear();
      previewIndex = undefined;
      preview.replaceChildren();
      select(undefined);
      localText(status, '');
    }
  };
}
