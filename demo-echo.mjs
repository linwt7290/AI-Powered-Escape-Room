import {canEchoAct, SCAN_ACTIONS, SCAN_FIELDS} from './rules.mjs';
import {INCIDENTS} from './puzzles.mjs';
import {AIRLOCK_ACTIONS} from './airlock.mjs';
import {DEFAULT_LOCALE, phrase, translate} from './i18n.mjs';

const routeMention = /\b([AB])\s*(?:号\s*)?(?:通道|路线|route\b|passage\b)|(?:通道|路线|route\s+|passage\s+)\s*([AB])\b/i;
const facts = [
  {name: '备用冷却的结果', group: /备用.{0,4}(冷却|回路)|备份冷却|后备冷却|冷却试压|backup (?:cooling|loop)|pressure test/i,
    result: /接管|接替|已启用|已启动|试压通过|流量稳定|taken over|took over|(?:is |now )running|restored|passed|stable/i},
  {name: '通过检测的通道及检查结果', group: routeMention, result: /通过|合格|安全|无异常|没问题|passed|qualified|safe/i}
];

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

export function demoDecision(state, history, message, incident, locale = DEFAULT_LOCALE) {
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
  if (!state.reportConfirmed) return reply('请在终端打开事故报告并确认已阅。');
  if (!state.coupler) return reply('从控制室东门进入维修间。维修柜里有备用耦合器。');
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

  const statements = [
    ...history.filter(turn => turn.role === 'user').map(turn => turn.content), message
  ].flatMap(text => text.match(/[^，,。.;；！？?!\n]+[！？?!]?/g) ?? [])
    .map(text => text.normalize('NFKC').replaceAll('’', "'").trim());
  const uncertain = /[?？]|是否|吗[!！]?$|还没|尚未|没有|并未|未(接|通过|启)|不(安全|通过|合格|稳定)|如果|假如|\b(?:not|never|if|didn't|hasn't|isn't|wasn't)\b/i;
  const missing = facts.filter(({group, result}, index) => {
    const relevant = statements.filter(text => group.test(text) && result.test(text)).at(-1);
    if (index === 1 && relevant) {
      const [, first, second] = relevant.match(group);
      const route = (first ?? second).toUpperCase();
      if (route !== state.route) return true;
    }
    return !relevant || uncertain.test(relevant);
  }).map(fact => fact.name);
  const matchesCause = (item, text) => item.aliases.test(text) || item.englishAliases.test(text);
  const reportedCause = statements.filter(text => Object.values(INCIDENTS).some(item => matchesCause(item, text))).at(-1);
  if (!reportedCause || uncertain.test(reportedCause) || !matchesCause(INCIDENTS[incident.kind], reportedCause)) {
    missing.unshift('本局触发封锁的原因');
  }

  if (missing.length) return reply(phrase('请说明{details}。', {
    details: missing.map(name => translate(locale, name)).join(locale === 'en' ? ', ' : '、')
  }));
  if (canEchoAct(state, 'request_unlock')) {
    return {reply: translate(locale, state.airlock ? '核验通过。撤离已授权，请到检测台操作缓冲舱。' : '核验通过。出口授权已提交。'),
      verification_passed: true, action: 'request_unlock'};
  }
  return reply('当前状态暂时无法授权撤离。');
}
