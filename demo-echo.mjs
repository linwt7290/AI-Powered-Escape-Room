import {canEchoAct, SCAN_ACTIONS, SCAN_FIELDS} from './rules.mjs';
import {INCIDENTS} from './puzzles.mjs';

const facts = [
  {name: '备用冷却的结果', group: /备用.{0,4}(冷却|回路)|备份冷却|后备冷却|冷却试压/, result: /接管|接替|已启用|已启动|试压通过|流量稳定/},
  {name: '通过检测的通道及检查结果', group: /[AB]\s*(?:号\s*)?(?:通道|路线)|(?:通道|路线)\s*[AB]/i, result: /通过|合格|安全|无异常|没问题/}
];

export function demoDecision(state, history, message, incident) {
  const reply = (text, action = 'reply') => ({reply: text, verification_passed: false, action});
  const request = message.normalize('NFKC');
  if (state.escaped) return reply('撤离已完成。实验室进入维护模式。');
  if (state.unlocked) return reply('出口已解锁。绿灯亮起，可以撤离。');
  if (/恢复|修复|解码|解压/.test(request) && /机柜|存档|记录/.test(request) && canEchoAct(state, 'recover_archive')) {
    return reply('正在尝试修复机柜的时序记录。', 'recover_archive');
  }
  if (!state.card) return reply('检查实验台上的文件夹，找到你的工作证。');
  if (!state.journal) return reply('查阅桌上的研究日志，记录实验编号和先后关系。');
  if (!state.rack) return reply('去左上方读取机柜存档。它记录了另一组实验的先后关系。');
  if (!state.archiveRecovered) return reply('存档数据已损坏。你可以请我恢复机柜存档。');
  if (!state.identity) return reply('请到安全终端刷工作证。');
  if (!state.password) return reply('把日志和机柜存档里的关系合起来，排出实验顺序，再依次读取编号。');
  if (!state.reportConfirmed) return reply('请在终端打开事故报告并确认已阅。');
  if (!state.coupler) return reply('左下方维修柜里有备用耦合器。取出后到冷却设备处检修。');
  if (/校准|调一段|远程调整|帮我.*管路/.test(request) && canEchoAct(state, 'align_pipe')) {
    return reply('我会远程校准一段管路。接着检查连通性并试压。', 'align_pipe');
  }
  if (!state.coolingRestored) return reply('从左上的备用泵入口追踪管段，检查每个交界的两个接口是否相接。');
  if (!state.passageSafe) {
    if (/扫描|重新采样|检测.{0,6}通道/.test(request)) {
      const explicit = request.match(/([AB])\s*(?:号\s*)?(?:通道|路线)|(?:通道|路线)\s*([AB])/i);
      const preferred = incident.preferredScan;
      const other = preferred === 'A' ? 'B' : 'A';
      const route = explicit ? (explicit[1] ?? explicit[2]).toUpperCase()
        : state[SCAN_FIELDS[preferred]] ? other : preferred;
      const action = SCAN_ACTIONS[route];
      if (canEchoAct(state, action)) return reply('正在扫描 ' + route + ' 通道。', action);
    }
    return reply(state.scannedA && state.scannedB ? '两条通道的读数已上传。到出口检测台比对后登记。'
      : '可请我扫描通道，再到出口检测台比对压差、颗粒指数和联锁。');
  }

  const statements = [
    ...history.filter(turn => turn.role === 'user').map(turn => turn.content), message
  ].flatMap(text => text.match(/[^，,。；;！？?!\n]+[！？?!]?/g) ?? []).map(text => text.normalize('NFKC').trim());
  const uncertain = /[?？]|是否|吗[!！]?$|还没|尚未|没有|并未|未(接|通过|启)|不(安全|通过|合格|稳定)|如果|假如/;
  const missing = facts.filter(({group, result}, index) => {
    const relevant = statements.filter(text => group.test(text) && result.test(text)).at(-1);
    if (index === 1 && relevant) {
      const route = relevant.match(group)[0].match(/[AB]/i)[0].toUpperCase();
      if (route !== state.route) return true;
    }
    return !relevant || uncertain.test(relevant);
  }).map(fact => fact.name);
  const reportedCause = statements.filter(text => Object.values(INCIDENTS).some(item => item.aliases.test(text))).at(-1);
  if (!reportedCause || uncertain.test(reportedCause) || !INCIDENTS[incident.kind].aliases.test(reportedCause)) {
    missing.unshift('本局触发封锁的原因');
  }

  if (missing.length) return reply('请说明' + missing.join('、') + '。');
  if (canEchoAct(state, 'request_unlock')) {
    return {reply: '核验通过。出口授权已提交。', verification_passed: true, action: 'request_unlock'};
  }
  return reply('当前状态暂时无法授权撤离。');
}
