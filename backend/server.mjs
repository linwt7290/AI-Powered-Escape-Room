import {DEFAULT_LOCALE, phrase, translate} from '../shared/i18n.mjs';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {loadEnvFile} from 'node:process';
import {fileURLToPath} from 'node:url';
import {canEchoAct, currentObjective, ECHO_ACTIONS, ECHO_FIELDS, pipeCoordinates, SCAN_ACTIONS, SCAN_FIELDS, UNLOCK_REQUIREMENTS, validPipeNumber} from '../shared/rules.mjs';
import {demoDecision, evacuationHint, registeredRoutePrompt, verifyEvacuation} from './demo-echo.mjs';
import {INCIDENTS, PARTICLE_LIMIT, describePassageCheck, passageFailures, passageReadings, PRESSURE_LIMIT} from '../shared/puzzles.mjs';
import {AIRLOCK_ACTIONS, airlockContext, validAirlock} from '../shared/airlock.mjs';
import {API_PATHS} from '../shared/api-paths.mjs';
import {validProgressTimeline} from '../shared/progress-timeline.mjs';
import {ECHO_STATE_GUIDE} from './echo-state-guide.mjs';
import {nextDoor, OBJECTS, ROOMS} from '../shared/room.mjs';

try {
  loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const {ECHO_API_KEY, ECHO_MODEL, ECHO_API_BASE, ECHO_PORT = '8788', PORT: hostingPort} = process.env;
const port = Number(hostingPort ?? ECHO_PORT);
const host = hostingPort === undefined ? '127.0.0.1' : '0.0.0.0';
const settings = [ECHO_API_KEY, ECHO_MODEL, ECHO_API_BASE];
const configured = settings.every(Boolean);
const mode = configured ? 'model' : settings.some(Boolean) ? 'incomplete' : 'demo';
const approvedApiBase = ECHO_API_BASE?.trim().replace(/\/+$/, '');
const directionNames = {north: '北门', south: '南门', east: '东门', west: '西门'};
const roomLayout = Object.values(ROOMS).map(({name, doors}) => name + '可经' + Object.entries(doors)
  .map(([side, to]) => directionNames[side] + '前往' + ROOMS[to].name).join('、')).join('。');
const assets = new Map([
  ['/', ['../frontend/index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['../frontend/index.html', 'text/html; charset=utf-8']],
  ['/frontend/index.html', ['../frontend/index.html', 'text/html; charset=utf-8']],
  ['/frontend/game.css', ['../frontend/game.css', 'text/css; charset=utf-8']],
  ['/frontend/assets/fonts/fusion-pixel-12px-zh-hans-2026.11.10.woff2', ['../frontend/assets/fonts/fusion-pixel-12px-zh-hans-2026.11.10.woff2', 'font/woff2']],
  ['/shared/i18n.mjs', ['../shared/i18n.mjs', 'text/javascript; charset=utf-8']],
  ['/frontend/ui-language.mjs', ['../frontend/ui-language.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/api-paths.mjs', ['../shared/api-paths.mjs', 'text/javascript; charset=utf-8']],
  ['/frontend/echo/api.mjs', ['../frontend/echo/api.mjs', 'text/javascript; charset=utf-8']],
  ['/frontend/game.mjs', ['../frontend/game.mjs', 'text/javascript; charset=utf-8']],
  ['/frontend/devices.mjs', ['../frontend/devices.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/airlock.mjs', ['../shared/airlock.mjs', 'text/javascript; charset=utf-8']],
  ['/frontend/airlock-panel.mjs', ['../frontend/airlock-panel.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/room.mjs', ['../shared/room.mjs', 'text/javascript; charset=utf-8']],
  ['/frontend/room-props.mjs', ['../frontend/room-props.mjs', 'text/javascript; charset=utf-8']],
  ['/frontend/pixel-art.mjs', ['../frontend/pixel-art.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/puzzles.mjs', ['../shared/puzzles.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/rules.mjs', ['../shared/rules.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/progress-timeline.mjs', ['../shared/progress-timeline.mjs', 'text/javascript; charset=utf-8']]
]);
const instructions = `你是密室游戏的中央 AI ECHO。以系统给出的游戏状态和 availableActions 为准，简短回应玩家。保护尚未读取的报告、密码及扫描结果。
如果现有信息无法回答玩家的问题、也无法给出有根据的提示，选择 reply 动作，并在 reply 字段中写「我不知道」。
你可以按上下文申请设备动作。玩家求助于损坏的机柜存档时选择 recover_archive。请求校准管路时选择 align_pipe，只调一段。请求扫描时，明确指定 A 或 B 就选择相应的 scan_route_a 或 scan_route_b。未指定时，可据对话选择其中一条，preferredScan 是本局的调度建议。已完成扫描的通道可引导玩家去检测台读数。设备动作的结果由游戏显示，请描述待执行动作，把实际结果留给设备回执。
根据进度给提示。玩家只问「下一步」或「接下来做什么」时，以 currentState.objective 为准，用一句话提示该目标对应的一项操作，必要时附上走法。专门询问密码、设备或证据时，按对应规则回答。只有玩家明确询问后续流程时才展开。玩家问「密码多少」「密码是什么」或「怎么推导密码」时，一律视为解谜求助，选择 reply，直接按当前进度给一条提示，不要以「我不知道」开头，也不要报出密码或完整实验顺序。journal 为 false 时，引导去研究室办公桌查看研究日志。日志已有而 archiveRecovered 为 false 时，rack 为 false 则引导去档案室调查机柜，rack 为 true 则提示可以请 ECHO 恢复机柜存档。两份线索齐备时，提示把两份记录里的先后关系合起来，排出实验顺序，再按顺序读取对应编号。备用冷却修复后，引导玩家扫描并比较通道。unlocked 或 escaped 为 true 时只回复。
研究室有工作证与研究日志，控制室有安全终端，档案室有机柜存档，维修间有备用冷却与备件柜，撤离区有检测台。location 是玩家所在的房间。有需要时按这张门牌图引路：${roomLayout}。
放行核验只认服务端给出的 evacuationMissing。请求放行或补报证据时，若有缺项，只引导去对应设备查找并汇报：封锁原因去控制室的事故报告，备用冷却去维修间看试压结果，达标通道去出口检测台看登记结果。询问证据出处时只给查找位置，不复述谜题答案或让玩家照抄。三项齐备且 availableActions 含 request_unlock 时，玩家提出申请或补齐证据可选择该动作。
通道问题使用 passage 的阈值和已扫描读数。问为何登记被拒时，结合 rejectedRoute 或玩家明确提到的通道解释失败项。只有已扫描的通道才有读数。单问所在位置时只答位置；同时问目标或方向时，依据 objective、objectiveRoom 和 objectiveDirection 补充下一步走法；airlock.inChamber 为 true 时可具体到缓冲舱。外门已开后问下一步，提示关闭面板、沿绿灯撤离。
状态含 airlock 时，request_unlock 只签发缓冲舱授权，外门仍关闭。授权后，你能切换门控电源，备用电源一次只能供一道门。open_outer_on_entry 表示玩家明确要求一进舱就切电；open_outer_after_inner_closed 表示明确要求等内门关严或联锁灯变绿后再切电，且该动作需要传感器在线。open_outer_now 表示玩家明确要求立刻切电，或已给出等待条件且传感器确认 innerDoorClosed=true。保留玩家指定的触发时机。只谈「怎么」或「为什么」、询问日志、未要求执行或时机有歧义时只回复。对于「怎么打开外门？」之类的宽泛求助，如果玩家还没有提到日志、联锁失败、内门或指示灯，只引导去读检测台旁的旧门控日志，不透露正确指示灯颜色和切电条件。玩家引用具体线索或描述试验结果后，可以解释它。innerDoorClosed=null 仅表示没有传感器读数。现场内门、外门和联锁灯以 airlock.display 为准。传感器离线时无法登记自动等待内门关严。可以由玩家观察现场指示灯后要求立即切电。若玩家要求「进舱就切电」，登记其指令，是否被联锁拒绝以设备回执为准。
备用冷却试压失败时，coolingFaultRow 是你能读到的掉压行。现场标红的列由玩家观察。只有 availableActions 含 isolate_pipe，且玩家在本轮明确要求隔离或旁通并报出匹配掉压行的行列时，才返回动作 isolate_pipe 和顶层整数 row、column。行列缺失或行号不符时只回复，提示玩家检查标红的接头。不要猜列号，设备回执负责确认漏点与执行结果。
只输出一个 JSON 对象，包含 reply（简短回复）、action（从 availableActions 选择一项）和 verification_passed（action 为 request_unlock 时为 true，其余为 false）。动作是 isolate_pipe 时额外提供 row 和 column。
只有选择了对应的定时动作才可以说已登记。传感器离线时，对等待内门关严的请求直接说明无法登记自动切电，再提示可由玩家现场观察后发出立即切电的指令。
设备动作示例：{"reply":"我会尝试恢复机柜存档。","verification_passed":false,"action":"recover_archive"}`;

function json(response, status, data) {
  response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
  response.end(JSON.stringify(data));
}

function resolveEchoSettings(overrides) {
  if (overrides === undefined) return {mode, model: ECHO_MODEL};
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides) ||
      typeof overrides.apiBase !== 'string' || overrides.apiBase.length > 2048 ||
      typeof overrides.model !== 'string' || overrides.model.length > 200) {
    return {status: 400, error: 'ECHO 设置格式无效。'};
  }
  const apiBase = overrides.apiBase.trim().replace(/\/+$/, '');
  const model = overrides.model.trim() || ECHO_MODEL;
  if (apiBase && apiBase !== approvedApiBase) {
    return {status: 400, error: 'API 地址须与服务端配置的 ECHO_API_BASE 一致。'};
  }
  if (!apiBase && !overrides.model.trim()) return {mode, model};
  if (!approvedApiBase || !ECHO_API_KEY || !model) {
    return {status: 503, error: '自定义设置需要服务端配置 ECHO_API_BASE 和 ECHO_API_KEY，并提供模型名称。'};
  }
  return {mode: 'model', model};
}

const nextStepQuestion = /^(?:我(?:现在)?(?:该|要)?|现在)?(?:然后呢|下一步(?:呢|做什么)?|接下来(?:呢|(?:我)?(?:该|要)?做什么))|^(?:what(?: should| do) I do next|what next|next step)/i;
const locationQuestion = /^(?:我(?:现在)?在哪(?:里|个房间)?|where am I)[？?。.!！]*$/i;
const scanCommand = /^(?:(?:请(?:你|\s*ECHO)?|帮我|开始|可以帮我|能帮我)\s*)?(?:扫描|重新扫描|请选择一条待查通道进行扫描|(?:please\s+)?(?:scan|rescan|choose (?:a passage to scan|an unscanned route and scan it)))|^(?:请)?[AB]\s*通道[，, ]*扫描/i;

function replyOnly(reply) {
  return {reply, action: 'reply', verification_passed: false};
}

function respondToDecision(response, fail, decision, state, messages, playerMessage, mode, verification, locale) {
  const wantsUnlock = decision?.action === 'request_unlock';
  if (typeof decision?.reply !== 'string' || !decision.reply.trim() || decision.reply.length > 2000 ||
      typeof decision.verification_passed !== 'boolean' || !ECHO_ACTIONS.includes(decision.action)) {
    return fail(502, 'ECHO 返回了无效决策，请重试。');
  }
  if (decision.verification_passed !== wantsUnlock) {
    return fail(502, 'ECHO 的核验结果与请求动作不一致。请重试。');
  }
  if (wantsUnlock && verification.missing.length) {
    decision = {reply: evacuationHint(verification.missing, locale, state.passageSafe), action: 'reply', verification_passed: false};
  }
  const namedScan = playerMessage.match(/\b([AB])\s*(?:通道|route|passage)|(?:通道|route|passage)\s*([AB])\b/i);
  const requestedScan = namedScan && SCAN_ACTIONS[(namedScan[1] ?? namedScan[2]).toUpperCase()];
  if (decision.action.startsWith('scan_route_') &&
      (!scanCommand.test(playerMessage.trim()) || /怎么|如何|为什么|标准|结果|\bhow\b|\bwhy\b/i.test(playerMessage) ||
        (requestedScan && decision.action !== requestedScan))) {
    decision = replyOnly(translate(locale, '请指定要扫描的通道，或请我选择一条。'));
  }
  if (!canEchoAct(state, decision.action)) {
    return fail(409, '当前设备状态无法执行这项 ECHO 动作。请确认进度后重试。');
  }
  if (decision.action === 'isolate_pipe') {
    const reported = pipeCoordinates(playerMessage);
    if (reported?.row !== decision.row || reported?.column !== decision.column || decision.row !== state.coolingFaultRow) {
      return fail(409, '旁通需要玩家报出与掉压读数一致的行列。');
    }
  }
  if (decision.action === AIRLOCK_ACTIONS.now) {
    decision = {...decision, reply: translate(locale, '收到。我现在尝试切电。')};
  }
  return json(response, 200, {decision, messages, mode, evacuationEvidence: verification.evidence});
}

async function handleEcho({request, response, locale, fail}, configOnly = false) {
  if (request.headers['content-type'] !== 'application/json') return fail(415, '请求格式错误。');

  let body = '';
  request.setEncoding('utf8');
  for await (const chunk of request) {
    body += chunk.toString('utf8');
    if (Buffer.byteLength(body) > 48_000) return fail(413, '消息过长。');
  }
  let input;
  try { input = JSON.parse(body); }
  catch { return fail(400, '无法读取对话请求。'); }
  const {state, history, message, incident, room, echoSettings, progressTimeline, evacuationEvidence = []} = input ?? {};
  const effective = resolveEchoSettings(echoSettings);
  if (effective.error) return fail(effective.status, effective.error);
  const {mode: requestMode, model} = effective;
  if (configOnly) return json(response, 200, {mode: requestMode});
  if (requestMode === 'incomplete') return fail(503, '请补齐 ECHO_API_KEY、ECHO_MODEL 和 ECHO_API_BASE 后重启服务。');
  if (typeof message !== 'string' || !message.trim() || message.length > 1000 ||
      !Array.isArray(evacuationEvidence) || evacuationEvidence.length > 3 ||
      !evacuationEvidence.every(text => typeof text === 'string' && text.length <= 2000) ||
      !Array.isArray(history) || history.length > 10 || !history.every(turn =>
        ['user', 'assistant'].includes(turn?.role) && typeof turn.content === 'string' && turn.content.length <= 2000) ||
      !ECHO_FIELDS.every(field => typeof state?.[field] === 'boolean') ||
      (progressTimeline !== undefined && !validProgressTimeline(progressTimeline)) ||
      (Object.hasOwn(state, 'coolingFaultRow') && state.coolingFaultRow !== null &&
        (!validPipeNumber(state.coolingFaultRow) || !state.reportConfirmed || !state.coupler || state.coolingRestored)) ||
      (room !== undefined && (typeof room !== 'string' || !Object.hasOwn(ROOMS, room))) ||
      typeof incident?.kind !== 'string' || !Object.hasOwn(INCIDENTS, incident.kind) ||
      typeof incident.preferredScan !== 'string' || !Object.hasOwn(SCAN_FIELDS, incident.preferredScan) ||
      (Object.hasOwn(state, 'airlock') && (!validAirlock(state.airlock) ||
        (state.airlock.authorized && !UNLOCK_REQUIREMENTS.every(field => state[field])) ||
        (state.airlock.phase === 'open') !== state.unlocked)) ||
      (incident.safeRoute !== undefined && !Object.hasOwn(SCAN_FIELDS, incident.safeRoute)) ||
      (state.rejectedRoute !== undefined && (!Object.hasOwn(SCAN_FIELDS, state.rejectedRoute) ||
        !state[SCAN_FIELDS[state.rejectedRoute]] || state.rejectedRoute === (incident.safeRoute ?? state.route))) ||
      (state.passageSafe
        ? typeof state.route !== 'string' || !Object.hasOwn(SCAN_FIELDS, state.route) || !state[SCAN_FIELDS[state.route]] ||
          (incident.safeRoute !== undefined && state.route !== incident.safeRoute)
        : state.route != null)) {
    return fail(400, '对话或游戏状态格式错误。');
  }

  const snapshot = {...Object.fromEntries(ECHO_FIELDS.map(field => [field, state[field]])), route: state.route ?? null};
  if (state.airlock) snapshot.airlock = state.airlock;
  if (Object.hasOwn(state, 'coolingFaultRow')) snapshot.coolingFaultRow = state.coolingFaultRow;
  const objective = currentObjective(snapshot);
  const context = {...snapshot, objective: objective.label};
  const targetRoom = OBJECTS[objective.target]?.room;
  const step = nextStepQuestion.test(message.trim());
  const canScan = ECHO_ACTIONS.some(action => action.startsWith('scan_route_') && canEchoAct(snapshot, action));
  const scanHelp = canScan && (step && !snapshot.scannedA && !snapshot.scannedB ||
    /(?:怎么|如何|怎样).{0,12}扫描|扫描.{0,8}(?:怎么|如何)|how.{0,24}scan/i.test(message));
  if (progressTimeline?.length) {
    context.progressTimeline = progressTimeline.map(({atMs, changes}) => ({atMs, changes}));
  }
  if (room) {
    context.location = ROOMS[room].name;
    if (targetRoom && targetRoom !== room) {
      context.objectiveDirection = directionNames[nextDoor(room, targetRoom)];
      context.objectiveRoom = ROOMS[targetRoom].name;
    }
  }
  if (snapshot.airlock) context.airlock = airlockContext(snapshot.airlock);
  const routeOnly = message.trim().match(/^(?:通道|route|passage)?\s*([AB])\s*(?:通道|route|passage)?[。.!！]*$/i);
  const lastReply = history.at(-1)?.role === 'assistant' ? history.at(-1).content : '';
  const answersRoutePrompt = canEchoAct(snapshot, 'request_unlock') && routeOnly &&
    (lastReply.includes(translate(locale, registeredRoutePrompt)) ||
      lastReply.includes(translate(locale, evacuationHint([2], locale))));
  const reportedMessage = answersRoutePrompt ? routeOnly[1].toUpperCase() + ' 通道通过检测。' : message;
  const verification = verifyEvacuation(snapshot, [...evacuationEvidence,
    ...history.filter(turn => turn.role === 'user').map(turn => turn.content)], reportedMessage, incident);
  const safeRoute = incident.safeRoute ?? snapshot.route;
  if (context.coolingRestored) {
    context.passage = {pressureLimit: PRESSURE_LIMIT, particleLimit: PARTICLE_LIMIT, interlockRequired: true,
      rejectedRoute: state.rejectedRoute ?? null, readings: {}};
    for (const [route, field] of Object.entries(SCAN_FIELDS)) {
      if (!snapshot[field] || !safeRoute) continue;
      const readings = passageReadings(incident.kind, route === safeRoute);
      context.passage.readings[route] = {...readings, failures: passageFailures(readings)};
    }
  }
  context.availableActions = ECHO_ACTIONS.filter(action => canEchoAct(snapshot, action));
  if (context.availableActions.includes('request_unlock')) {
    context.evacuationMissing = verification.missing.map(index => ['封锁原因', '备用冷却结果', '达标通道'][index]);
  }
  if (context.availableActions.some(action => action.startsWith('scan_route_'))) context.preferredScan = incident.preferredScan;
  const answer = (reply, offerScan = false, action = 'reply') => json(response, 200, {
    decision: {...replyOnly(reply), action}, messages: null, mode: requestMode,
    evacuationEvidence: verification.evidence, offerScan
  });
  const asksForEvidence = /怎么|如何|哪里|在哪|哪儿|\b(?:where|how)\b/i.test(message);
  if (asksForEvidence && !/扫描|\bscan\b/i.test(message)) {
    if (/封锁.{0,8}原因|原因.{0,8}封锁|lockdown/i.test(message)) {
      return answer(evacuationHint([0], locale));
    }
    if (/试压结果|备用冷却.{0,8}结果|pressure test|backup cooling/i.test(message)) {
      return answer(evacuationHint([1], locale));
    }
    if (/登记结果|达标通道|哪条通道.{0,8}(?:通过|达标)|which (?:route|passage)/i.test(message)) {
      return answer(evacuationHint([2], locale));
    }
  }
  if (context.availableActions.includes('request_unlock')) {
    const submitsEvidence = verifyEvacuation(snapshot, [], reportedMessage, incident).evidence.length > 0;
    const requestsEvacuation = /^(?:请|帮我|我要|可以)?(?:申请(?:撤离|放行)|放行|授权撤离)|^(?:please )?(?:request|authorize) evacuation/i.test(message.trim());
    if (step) {
      return answer(verification.missing.length
        ? evacuationHint(verification.missing, locale, true)
        : translate(locale, '三项核验通过。请申请撤离放行。'));
    }
    if (submitsEvidence || requestsEvacuation || answersRoutePrompt) {
      const decision = demoDecision(snapshot, history, message, incident, locale, verification);
      return respondToDecision(response, fail, decision, snapshot, null, message, requestMode, verification, locale);
    }
  }
  const namedRoute = message.match(/\b([AB])\s*(?:通道|route|passage)|(?:通道|route|passage)\s*([AB])\b/i);
  const choosesScan = routeOnly && canScan &&
    /(?:选择|指定).{0,16}(?:扫描|通道)|扫描\s*[AB]\s*通道|正在扫描|核验通道读数|\bwhich passage to scan\b|\bscan (?:route |passage )?[AB]\b|\bscanning (?:route |passage )?[AB]\b|check the (?:passage )?readings/i.test(lastReply);
  if (choosesScan || (namedRoute && scanCommand.test(message.trim()) &&
      !/怎么|如何|为什么|标准|结果|\bhow\b|\bwhy\b/i.test(message))) {
    const route = (routeOnly?.[1] ?? namedRoute[1] ?? namedRoute[2]).toUpperCase();
    const action = SCAN_ACTIONS[route];
    if (canEchoAct(snapshot, action)) {
      return answer(translate(locale, phrase('正在扫描 {route} 通道。', {route})), true, action);
    }
    if (snapshot[SCAN_FIELDS[route]]) {
      return answer(translate(locale, phrase('{route} 通道扫描完成，读数已上传至出口检测台。', {route})), canScan);
    }
  }
  const asksForCard = /工作证|工牌|身份卡|staff ID|ID card/i.test(message) &&
    /在哪|哪里|哪儿|怎么找|去哪|\bwhere\b/i.test(message);
  if (asksForCard) {
    return answer(translate(locale, snapshot.card ? '工作证已收起。' : '工作证在研究室的办公桌上。'));
  }
  if (step && objective.target === 'exit' && !snapshot.airlock?.authorized) {
    const hint = context.objectiveDirection
      ? phrase('从{location}的{direction}走，前往撤离区的出口检测台核验通道读数。', {location: context.location, direction: context.objectiveDirection})
      : '到撤离区的出口检测台核验通道读数。';
    return answer(translate(locale, hint), canScan);
  }
  if (scanHelp) return answer(translate(locale, '请指定要扫描的通道，或请我选择一条。'), true);
  if (step && objective.target === 'card') {
    return answer(translate(locale, '先到研究室办公桌拾取工作证。'));
  }
  if (step && objective.target === 'journal') {
    return answer(translate(locale, '查看研究室办公桌上的研究日志。'));
  }
  if (room && locationQuestion.test(message.trim()) && context.objectiveDirection &&
      progressTimeline?.filter(event => Object.hasOwn(event.changes, 'room')).length &&
      history.some(turn => turn.role === 'user' && nextStepQuestion.test(turn.content.trim())) &&
      objective.target === 'rack') {
    return answer(translate(locale, phrase('你在{location}。从{direction}走，前往档案室查看机柜存档。', {
      location: context.location, direction: context.objectiveDirection
    })));
  }
  const askedRoute = message.match(/([AB])\s*(?:通道|route)|(?:通道|route)\s*([AB])/i);
  if (askedRoute && /为什么|为何|为啥|\bwhy\b/i.test(message) && /通过|达标|合格|拒绝|pass|fail|reject/i.test(message)) {
    const route = (askedRoute[1] ?? askedRoute[2]).toUpperCase();
    const readings = context.passage?.readings[route];
    if (readings) return answer(translate(locale, describePassageCheck(route, readings)));
    return answer(translate(locale, '请先扫描通道，再到出口检测台查看读数。'));
  }
  if (requestMode === 'demo') return respondToDecision(response, fail, demoDecision(snapshot, history, message, incident, locale, verification), snapshot, null, message, requestMode, verification, locale);
  const completionUrl = new URL(approvedApiBase + '/chat/completions');
  const usesDeepSeek = completionUrl.hostname === 'api.deepseek.com';
  const readsFinalState = usesDeepSeek && (context.unlocked || context.escaped);
  const replyLanguage = locale === 'en' ? 'Write your reply in English.' : '请用简体中文回复。';
  const responseInstructions = instructions + '\n' + replyLanguage + ' 回复中的顺序请用文字表达，避免箭头符号。';
  const systemPrompt = readsFinalState
    ? '你是实验室中央 AI ECHO。根据系统给出的当前游戏状态，用一句话回应玩家。单问位置时只答位置，airlock.inChamber 为 true 时答在撤离区的缓冲舱内。问下一步且外门已开时，提示关闭面板、沿绿灯撤离。escaped 为 true 表示玩家已撤离，否则 unlocked 为 true 表示出口已解锁，玩家可以离开。只输出纯文本。' + replyLanguage
    : responseInstructions;
  const contextInstructions = `
最后一条消息由服务端以 JSON 发送。playerMessage 是玩家本轮原话，currentState 是服务端提供的本轮状态。核验玩家陈述时，本轮只把 playerMessage 视为玩家原话，结合规则允许使用的历史玩家陈述；currentState 是核对依据，不能充当玩家证据。
回答前先区分玩家问的是含义、当前状态还是过去的经过。只问含义时只解释含义。问当前状态时，先读取 currentState 中对应的值；true、false 都是明确的值。历史仅用于理解指代或补充状态未覆盖的背景。旧回复或提问中的旧前提与本轮状态冲突时，按本轮状态回答。
问过去的经过或先后顺序时，参考 progressTimeline。atMs 是开局后的毫秒数，同一时间按数组顺序；changes 是变化后的字段值，room 是房间标识。缺少记录时说明无法确认。`;
  const messages = [
    {role: 'system', content: systemPrompt + '\n' + ECHO_STATE_GUIDE + contextInstructions},
    ...history.map(({role, content}) => ({
      role,
      // History contains displayed dialogue. Current device progress comes from the state snapshot.
      content: role === 'assistant' && !readsFinalState
        ? JSON.stringify({reply: content, action: 'reply', verification_passed: false})
        : content
    })),
    {role: 'user', content: JSON.stringify({playerMessage: message, currentState: context})}
  ];
  const completion = {model, messages};
  if (!readsFinalState) completion.response_format = {type: 'json_object'};
  if (usesDeepSeek) {
    completion.thinking = {type: 'disabled'};
    completion.max_tokens = 512;
  }
  const signal = AbortSignal.timeout(30_000);
  let decision;
  for (let attempt = 0; attempt < 2; attempt++) {
    const upstream = await fetch(completionUrl, {
      method: 'POST',
      headers: {Authorization: 'Bearer ' + ECHO_API_KEY, 'Content-Type': 'application/json'},
      body: JSON.stringify(completion),
      signal
    });
    if (!upstream.ok) {
      return fail(502, phrase('模型服务返回 HTTP {status}。请检查 API 地址、模型和密钥。', {status: upstream.status}));
    }
    try {
      const result = await upstream.json();
      const content = result?.choices?.[0]?.message?.content;
      const trimmedContent = typeof content === 'string' ? content.trim() : '';
      if (usesDeepSeek && !readsFinalState && attempt === 0 && typeof content === 'string' && !trimmedContent) {
        messages[0].content = responseInstructions + '\n' + ECHO_STATE_GUIDE + contextInstructions + '\n请直接输出包含三个字段的完整 JSON 对象。';
        completion.thinking = {type: 'enabled'};
        completion.reasoning_effort = 'low';
        completion.max_tokens = 2048;
        continue;
      }
      if (trimmedContent) {
        decision = readsFinalState
          ? {reply: trimmedContent, verification_passed: false, action: 'reply'}
          : JSON.parse(content);
      }
    } catch {
      return fail(502, 'ECHO 返回了无效决策，请重试。');
    }
    break;
  }
  respondToDecision(response, fail, decision, snapshot, messages, message, requestMode, verification, locale);
}

const apiRoutes = new Map([
  ['GET ' + API_PATHS.health, ({response}) => json(response, 200, {configured, mode})],
  ['POST ' + API_PATHS.echoConfig, context => handleEcho(context, true)],
  ['POST ' + API_PATHS.echo, handleEcho]
]);

const server = createServer(async (request, response) => {
  const locale = request.headers['accept-language'] === 'en' ? 'en' : DEFAULT_LOCALE;
  const fail = (status, message) => json(response, status, {error: translate(locale, message)});
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const handler = apiRoutes.get(request.method + ' ' + path);
    if (handler) return await handler({request, response, locale, fail});
    const asset = assets.get(path);
    if (request.method === 'GET' && asset) {
      const [file, type] = asset;
      let content;
      try { content = await readFile(new URL(file, import.meta.url)); }
      catch (error) {
        if (error.code === 'ENOENT') return json(response, 404, {error: '缺少资源 ' + file + '。'});
        throw error;
      }
      if (type === 'font/woff2') response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      response.writeHead(200, {'Content-Type': type});
      response.end(content);
      return;
    }
    return fail(404, '页面不存在。');
  } catch {
    fail(502, 'ECHO 未能完成请求。请检查连接并重试。');
  }
});
server.listen(port, host, () => console.log('最后的协议 http://' + host + ':' + server.address().port));
