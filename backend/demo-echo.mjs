import {nextDoor, REPORT_FRAGMENTS, ROOMS} from '../shared/room.mjs';
import {canEchoAct, SCAN_ACTIONS, SCAN_FIELDS} from '../shared/rules.mjs';
import {INCIDENTS} from '../shared/puzzles.mjs';
import {AIRLOCK_ACTIONS} from '../shared/airlock.mjs';
import {DEFAULT_LOCALE, phrase, translate} from '../shared/i18n.mjs';

const routeMention = /\b([AB])\s*(?:号\s*)?(?:通道|路线|route\b|passage\b)|(?:通道|路线|route\s+|passage\s+)\s*([AB])\b/i;
const coolingSubject = /备用.{0,4}(冷却|回路)|备份冷却|后备冷却|冷却试压|backup (?:cooling|loop)|pressure test/i;
const coolingResult = /接管|接替|已启用|已启动|试压通过|流量稳定|taken over|took over|(?:is |now )running|restored|passed|stable/i;
const routeResult = /通过|合格|安全|无异常|没问题|passed|qualified|safe/i;

function airlockDecision(state, request, reply) {
  const {airlock} = state;
  const {now, onEntry, afterClosing} = AIRLOCK_ACTIONS;
  if (airlock.phase === 'rejected') return reply('切电被联锁拒绝了。先退回实验室，再调整切电时机。');
  if (/为什么|为何|为啥|没开成|怎么失败|怎么回事|\bwhy\b/i.test(request)) {
    return reply('门控日志里，进舱时内门还在关闭。比对两次操作切电时的联锁灯。');
  }
  const command = !/怎么|怎样|如何|能(?:否|不能).{0,4}解释|(?:不要|别|先不)(?:切|开|通电)|\bhow\b|\b(?:do not|don't)\b/i.test(request) &&
    /切电|切换电源|给.{0,12}通电|(?:打开|开启|解锁|开).{0,8}(?:外门|外边|外面|外侧|出口)|(?:switch|transfer|redirect) power|(?:open|unlock|power) (?:the )?(?:outer door|exit)/i.test(request);
  if (command) {
    const waits = /(?:等|一旦|当|只要|确认).{0,26}(?:关严|关好|关上|锁好|锁定|变绿|绿灯)|(?:关严|关好|关上|锁好|变绿|绿灯亮).{0,5}(?:后|再)|\b(?:until|after|once|when)\b.{0,64}\b(?:closes|closed|seals|sealed|green)\b/i.test(request);
    if (waits) {
      if (canEchoAct(state, afterClosing)) return reply('我会等门位传感器确认内门关严，再切换电源。', afterClosing);
      if (!airlock.sensor) return reply('门位传感器离线。你可以观察现场灯，在合适时机叫我切电。');
      if (canEchoAct(state, now)) return reply('传感器确认内门已关严。我现在尝试切电。', now);
    }
    if (/一进|刚进|进(?:入)?(?:缓冲舱|舱)(?:时|就|后)|(?:when|once|as soon as|after) I (?:enter|step into)|(?:on|upon) entry/i.test(request)) {
      return canEchoAct(state, onEntry) ? reply('我会在检测到你进舱时切电。', onEntry)
        : reply('进舱信号已经过去。请退出缓冲舱，或重新告诉我何时切电。');
    }
    if (canEchoAct(state, now)) return reply('收到。我现在尝试切电。', now);
    return reply('请先进入缓冲舱，或交代我在什么时机切电。');
  }
  return reply('撤离已经授权。检测台旁有两次门控操作记录，可以查看当时的联锁灯和切电结果。');
}

export function reportGuidance(state, locale, room) {
  const say = (message, values) => translate(locale, values ? phrase(message, values) : message);
  if (!state.password) return say('先在控制室的安全终端输入四位密码，终端才会显示残页位置。');
  if (state.reportConfirmed) return say('事故报告已确认，可以在调查记录中回看。');
  if (!Array.isArray(state.reportFragments) || state.reportOpen) {
    return say('请在终端打开事故报告并确认已阅。');
  }
  const remaining = Object.entries(REPORT_FRAGMENTS).filter(([key]) => !state.reportFragments.includes(key));
  const targetRoom = remaining[0]?.[1].room ?? 'control';
  const directions = {north: '北门', south: '南门', east: '东门', west: '西门'};
  const door = room && nextDoor(room, targetRoom);
  const path = door ? say('先从{direction}进入{room}。', {
    direction: say(directions[door]), room: say(ROOMS[ROOMS[room].doors[door]].name)
  }) : '';
  const hint = remaining.length
    ? say('报告还缺 {count} 块残页，去这些房间找：{rooms}。取齐后回控制室的安全终端拼接。', {
      count: remaining.length,
      rooms: remaining.map(([, fragment]) => say(ROOMS[fragment.room].name)).join(locale === 'en' ? ', ' : '、')
    })
    : say('残页已经找齐。回控制室的安全终端，对齐纸边和断开的文字，拼好后点击「确认已阅」。');
  return [hint, path].filter(Boolean).join(' ');
}

export function demoDecision(state, history, message, incident, locale = DEFAULT_LOCALE, verification = verifyEvacuation(state, history.filter(turn => turn.role === 'user').map(turn => turn.content), message, incident)) {
  const reply = (text, action = 'reply') => ({reply: translate(locale, text), verification_passed: false, action});
  const request = message.normalize('NFKC').replaceAll('’', "'");
  if (state.escaped) return reply('撤离已完成。实验室进入维护模式。');
  if (state.unlocked) return reply('出口已解锁。绿灯亮起，可以撤离。');
  if (state.airlock?.authorized) return airlockDecision(state, request, reply);
  if (/恢复|修复|解码|解压|restore|recover|repair|decode/i.test(request) &&
      /机柜|存档|记录|server|archive|record/i.test(request) && canEchoAct(state, 'recover_archive')) {
    return reply('正在尝试修复机柜的时序记录。', 'recover_archive');
  }
  if (!state.card) return reply('检查研究室办公桌上的文件夹，找到你的工作证。');
  if (!state.journal) return reply('查阅研究室桌上的日志，记录实验编号和先后关系。');
  if (!state.rack) return reply('从控制室北门进入档案室，读取机柜存档。它记录了另一组实验的先后关系。');
  if (!state.archiveRecovered) return reply('存档数据已损坏。你可以请我恢复机柜存档。');
  if (!state.identity) return reply('请到控制室的安全终端刷工作证。');
  if (!state.password) return reply('把日志和机柜存档里的关系合起来，排出实验顺序，再依次读取编号。');
  if (!state.reportConfirmed) return reply(reportGuidance(state, locale));
  if (!state.coupler) return reply('从控制室东门进入维修间。维修柜里有备用耦合器。');
  if (canEchoAct(state, 'isolate_pipe')) {
    if (!/怎么|如何|为什么|(?:^|\s)(?:how|why)\b|不要|别|\b(?:don't|do not)\b/i.test(request) &&
        /旁通|隔离|改错|修复|修好|修掉|解决|帮我修|\b(?:bypass|isolate|fix|repair)\b/i.test(request)) {
      return reply('我会尝试旁通试压标红的接头。', 'isolate_pipe');
    }
    return reply(phrase('第 {row} 行掉压。你可以手动调整标红的接头，或让我旁通漏点。', {row: state.coolingFaultRow}));
  }
  if (/校准|调一段|远程调整|帮我.*管路|\balign\b|\bcalibrate\b/i.test(request) && canEchoAct(state, 'align_pipe')) {
    return reply('我会远程校准一段管路。接着检查连通性并试压。', 'align_pipe');
  }
  if (!state.coolingRestored) return reply('从左上的备用泵入口追踪管段，检查每个交界的两个接口是否相接。');
  if (!state.passageSafe) {
    if (/扫描|重新采样|检测.{0,6}通道|\bscan\b|\brescan\b/i.test(request)) {
      const explicit = request.match(routeMention);
      const preferred = incident.preferredScan;
      const other = preferred === 'A' ? 'B' : 'A';
      const route = explicit ? (explicit[1] ?? explicit[2]).toUpperCase()
        : state[SCAN_FIELDS[preferred]] ? other : preferred;
      const action = SCAN_ACTIONS[route];
      if (canEchoAct(state, action)) return reply(phrase('正在扫描 {route} 通道。', {route}), action);
    }
    return reply(state.scannedA && state.scannedB ? '两条通道的读数已上传。到出口检测台比对后登记。'
      : '可请我扫描通道，再到出口检测台比对压差、颗粒指数和联锁。');
  }

  const {missing} = verification;
  if (missing.length) return reply(evacuationHint(missing, locale, state.passageSafe));
  if (canEchoAct(state, 'request_unlock')) {
    return {reply: translate(locale, '三项核验通过。'),
      verification_passed: true, action: 'request_unlock'};
  }
  return reply('当前状态暂时无法授权撤离。');
}

const evidenceHints = [
  '到控制室查阅事故报告，说明触发封锁的原因。',
  '到维修间查看备用冷却的试压结果，再告诉我结果。',
  '到出口检测台核对登记结果，再告诉我哪条通道通过了检测。'
];

export const registeredRoutePrompt = '请告诉我哪条通道通过了检测。';

export function evacuationHint(missing, locale, passageRegistered = false) {
  return missing.map(index => translate(locale, index === 2 && passageRegistered
    ? registeredRoutePrompt : evidenceHints[index])).join(' ');
}

export function verifyEvacuation(state, history, message, incident) {
  const matchesCause = (item, text) => item.aliases.test(text) || item.englishAliases.test(text);
  const evidence = [null, null, null];
  const uncertain = /[?？]|是否|是不是|(?:吗|么|呢)[。！!]?$|如果|假如|也许|可能|还没|尚未|仍未|并不|没有|并未|未(?:接|通过|启)|不(?:安全|通过|合格|稳定)|不够稳定|未达标|未能|没能|不确定|失败|\bunsafe\b|\b(?:not|never|if|maybe|didn't|hasn't|isn't|wasn't)\b/i;
  for (const text of [...history, message]) {
    for (const clause of text.normalize('NFKC').replaceAll('’', "'").match(/[^，,。.;；！？?!\n]+[！？?!]?/g) ?? []) {
      const statement = clause.trim();
      if (uncertain.test(statement)) continue;
      const cause = INCIDENTS[incident.kind];
      if (state.reportConfirmed && matchesCause(cause, statement)) evidence[0] = statement;
      if (state.coolingRestored && (coolingSubject.test(statement) && coolingResult.test(statement) ||
          /试压(?:流量)?稳定|试压通过|流量稳定/i.test(statement))) evidence[1] = statement;
      const route = statement.match(routeMention);
      if (state.passageSafe && route && (route[1] ?? route[2]).toUpperCase() === state.route &&
          routeResult.test(statement) &&
          [...statement.matchAll(new RegExp(routeMention.source, 'gi'))].length === 1) evidence[2] = statement;
    }
  }
  return {evidence: [...new Set(evidence.filter(Boolean))], missing: [0, 1, 2].filter(index => !evidence[index])};
}
