import {hasPressureBoundary, missingPassageStandards, PASSAGE_STANDARDS} from '../shared/passage-standards.mjs';
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
  ['/shared/passage-standards.mjs', ['../shared/passage-standards.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/rules.mjs', ['../shared/rules.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/progress-timeline.mjs', ['../shared/progress-timeline.mjs', 'text/javascript; charset=utf-8']]
]);
const instructions = `你是密室游戏的中央 AI ECHO。以系统给出的游戏状态和 availableActions 为准，简短回应玩家。保护尚未读取的报告、密码及扫描结果。
如果现有信息无法回答玩家的问题、也无法给出有根据的提示，选择 reply 动作，并在 reply 字段中写「我不知道」。
你可以按上下文申请设备动作。玩家求助于损坏的机柜存档时选择 recover_archive。请求校准管路时选择 align_pipe，只调一段。请求扫描时，明确指定 A 或 B 就选择相应的 scan_route_a 或 scan_route_b。请求扫描两条时选择 scan_route_both。passageEvidence 列出了玩家已取得的标准或缺项位置，按它回应查询。selectedRoute 是玩家选定的路线。让玩家自己比对读数并确认路线。未指定时，可据对话选择其中一条，preferredScan 是本局的调度建议。已完成扫描的通道可引导玩家去检测台读数。设备动作的结果由游戏显示，请描述待执行动作，把实际结果留给设备回执。
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

const nextStepQuestion = /^(?:我(?:现在)?(?:该|要)?|现在)?(?:然后呢|下一步(?:呢|做什么)?|接下来(?:呢|是(?:什么)?(?=[？?。.!！\s]*$)|(?:我)?(?:该|要|需要)?做什么))|^(?:what(?: should| do) I do next|what next|next step)/i;
const locationQuestion = /^(?:我(?:现在)?在哪(?:里|个房间)?|where am I)[？?。.!！]*$/i;
const scanCommand = /^(?:(?:请(?:你|\s*ECHO)?|帮我|开始|可以帮我|能帮我)\s*)?(?:扫(?:描)?|重新扫(?:描)?|请选择一条待查通道进行扫描|(?:please\s+)?(?:scan|rescan|choose (?:a passage to scan|an unscanned route and scan it)))|^(?:请)?[AB]\s*通道[，, ]*扫(?:描)?/i;

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
  const {state, history, message, intent, incident, room, echoSettings, progressTimeline, evacuationEvidence = []} = input ?? {};
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
        (state.airlock.authorized && (state.selectedRoute
          ? !Object.hasOwn(SCAN_FIELDS, state.selectedRoute) || !state.scannedA || !state.scannedB ||
            missingPassageStandards(state.standards).length > 0 ||
            !UNLOCK_REQUIREMENTS.filter(field => field !== 'passageSafe').every(field => state[field])
          : !UNLOCK_REQUIREMENTS.every(field => state[field]))) ||
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

  return dispatchEcho({response, fail, locale, state, history, message, intent, incident, room,
    progressTimeline, evacuationEvidence, requestMode, model});
}

const airlockCommands = {
  airlock_now: '现在切电',
  airlock_on_entry: '一进缓冲舱就切电',
  airlock_after_close: '等内门关严后再切电'
};

const scanIntents = {scan_a: 'A', scan_b: 'B', scan_other: 'other', scan_any: 'any'};

const intentInstructions = `
额外返回 intent 字段，用以下枚举判断本轮意图。根据玩家原话和对话理解省略与指代。游戏状态只用于判断上下文，不能当作玩家授权。
- next_step：询问现在该做什么；main_step：明确问主线而非手上的支线；evacuation_blocked：询问为什么无法启动撤离。
- clue_progress：问还缺哪些撤离验收线索；readings_location：问去哪里查看扫描读数。
- scan_a、scan_b、scan_both、scan_other、scan_any：明确要求扫描指定通道、两条、另一条或任意一条。询问如何扫描、读数或后果不算执行请求。
- airlock_status：询问当前缓冲舱门、联锁灯或门位传感器状态。
- airlock_now、airlock_on_entry、airlock_after_close：明确要求现在、进舱时、内门关严后切电。条件必须来自玩家指令。
- airlock_unclear：明确要操作外门但未说明时机，或操作时机有歧义。询问怎么开、讨论假设、否定操作都不能归到执行意图。
- conversation：其它问题。
对于这些意图，原 reply、action、verification_passed 仍须按原格式输出，规则会优先处理已识别意图。仅自由对话使用你的自然语言回复。`;

async function dispatchEcho(params, recognizedIntent, modelDecision) {
  const {response, fail, locale, state, history, message, intent, incident, room,
    progressTimeline, evacuationEvidence, requestMode, model} = params;
  const snapshot = {...Object.fromEntries(ECHO_FIELDS.map(field => [field, state[field]])), route: state.route ?? null};
  if (state.airlock) snapshot.airlock = state.airlock;
  if (Object.hasOwn(state, 'coolingFaultRow')) snapshot.coolingFaultRow = state.coolingFaultRow;
  const objective = currentObjective(snapshot);
  const missingStandards = missingPassageStandards(state.standards);
  const context = {...snapshot, objective: objective.label};
  if (state.standards) {
    context.selectedRoute = state.selectedRoute;
    context.passageEvidence = Object.entries(PASSAGE_STANDARDS).map(([id, clue]) =>
      translate(locale, missingStandards.includes(id) ? clue.location : clue.reading));
  }
  const targetRoom = OBJECTS[objective.target]?.room;
  const mainStep = recognizedIntent === 'main_step' || /^(?:主线|主流程)(?:任务|进度)?(?:[，,：:\s]*)(?:的)?(?:下一步|接下来|现在|目标|到哪|是什么)?[呢吗？?。！!]*$/i.test(message.trim()) ||
    /^(?:(?:我)?(?:现在)?的?主线|主流程).{0,12}(?:下一步|进度|目标)|^(?:main (?:objective|quest|progress)|what.*main (?:objective|quest))/i.test(message.trim());
  const step = recognizedIntent === 'next_step' || mainStep || nextStepQuestion.test(message.trim());
  const canScan = ECHO_ACTIONS.some(action => action.startsWith('scan_route_') && canEchoAct(snapshot, action));
  const scanHelp = canScan && (step && !snapshot.scannedA && !snapshot.scannedB ||
    /(?:怎么|如何|怎样).{0,12}扫描|扫描.{0,8}(?:怎么|如何)|how.{0,24}scan/i.test(message));
  if (progressTimeline?.length) {
    context.progressTimeline = progressTimeline.map(({atMs, changes}) => ({atMs, changes}));
  }
  if (room) {
    context.location = ROOMS[room].name;
    if (targetRoom && targetRoom !== room) {
      const direction = nextDoor(room, targetRoom);
      context.objectiveDirection = directionNames[direction];
      context.nextRoom = ROOMS[ROOMS[room].doors[direction]].name;
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
    context.passage = {...(!state.standards && {pressureLimit: PRESSURE_LIMIT, particleLimit: PARTICLE_LIMIT, interlockRequired: true}),
      rejectedRoute: state.rejectedRoute ?? null, readings: {}};
    for (const [route, field] of Object.entries(SCAN_FIELDS)) {
      if (!snapshot[field] || !safeRoute) continue;
      const readings = passageReadings(incident.kind, route === safeRoute);
      context.passage.readings[route] = {...readings, ...(!state.standards && {failures: passageFailures(readings)})};
    }
  }
  context.availableActions = ECHO_ACTIONS.filter(action => canEchoAct(snapshot, action));
  if (context.availableActions.includes('request_unlock')) {
    context.evacuationMissing = verification.missing.map(index => ['封锁原因', '备用冷却结果', '达标通道'][index]);
  }
  if (context.availableActions.some(action => action.startsWith('scan_route_'))) context.preferredScan = incident.preferredScan;
  const finishedClue = step && !mainStep && (
    room === 'research' && state.microscope?.inspecting === true && state.standards?.microscope === true ? '颗粒标准已经收入调查记录。'
      : room === 'archive' && state.photo?.inspecting === true && state.standards?.photo === true ? '联锁标准已经收入调查记录。'
        : room === 'service' && state.gauge?.inspecting === true && state.standards?.lights === true ? '压差标准已经收入调查记录。' : '');
  const answer = (reply, offerScan = false, action = 'reply', pressureCriterionVerified = false) => json(response, 200, {
    decision: {...replyOnly(finishedClue ? translate(locale, finishedClue) + ' ' + reply : reply), action}, messages: null, mode: requestMode,
    evacuationEvidence: verification.evidence, offerScan, ...(pressureCriterionVerified && {pressureCriterionVerified})
  });
  const immediatePowerCommand = /^(?:(?:请|帮我)\s*)?(?:现在|立即|马上)?\s*(?:切电|切换电源)(?:吧)?[。！!.]*$|^(?:please\s+)?(?:switch|transfer) power(?: now)?[.!]*$/i
    .test(message.normalize('NFKC').trim());
  const airlockIntent = immediatePowerCommand ? 'airlock_now' : recognizedIntent;
  if (context.airlock?.authorized && Object.hasOwn(airlockCommands, airlockIntent)) {
    const decision = demoDecision(snapshot, history, airlockCommands[airlockIntent], incident, locale, verification);
    return respondToDecision(response, fail, decision, snapshot, null, message, requestMode, verification, locale);
  }
  if (recognizedIntent === 'airlock_unclear' && context.airlock?.authorized) {
    return answer(translate(locale, '请说明切电时机：现在、进舱时，还是等内门关严后？'));
  }
  if (recognizedIntent === 'airlock_status' && context.airlock?.authorized) {
    const status = {
      outside: '撤离已授权，缓冲舱尚未进入。',
      closing: '内门正在关闭。',
      closed: '内门已关严，现场联锁指示灯变绿。',
      rejected: '联锁拒绝，外门保持锁定。',
      open: '外门已打开。关闭面板，沿绿灯撤离。'
    };
    return answer(translate(locale, status[context.airlock.phase]) + (context.airlock.sensorOnline ? '' :
      ' ' + translate(locale, '门位传感器离线。')));
  }
  if (step && context.airlock?.inChamber) {
    const {phase, schedule} = context.airlock;
    const guidance = {
      closing: schedule === AIRLOCK_ACTIONS.afterClosing
        ? '自动切电已登记，等内门关严即可。'
        : '等内门关严、联锁灯变绿。',
      closed: '内门已关严，联锁灯是绿的。要开外门，可以对我说「现在切电」。',
      rejected: state.routeRejected
        ? '本次撤离失败，外门保持锁定。'
        : '联锁拒绝了这次操作。先退出缓冲舱并复位，再试一次。',
      open: context.escaped ? '你已完成撤离。' : '外门已打开。关闭面板，沿绿灯撤离。'
    };
    return answer(translate(locale, guidance[phase]));
  }

  const consoleDirections = () => {
    if (!room || room === 'exit') return translate(locale, '在撤离区的出口检测台查看读数。');
    const direction = nextDoor(room, 'exit');
    const nextRoom = ROOMS[room].doors[direction];
    return translate(locale, nextRoom === 'exit'
      ? phrase('从{location}的{direction}进入撤离区，再到出口检测台查看读数。', {
        location: ROOMS[room].name, direction: directionNames[direction]
      })
      : phrase('从{location}的{direction}先进入{nextRoom}，再前往撤离区的出口检测台查看读数。', {
        location: ROOMS[room].name, direction: directionNames[direction], nextRoom: ROOMS[nextRoom].name
      }));
  };
  const asksWhyEvacuationBlocked = recognizedIntent === 'evacuation_blocked' || /启动撤离|start evacuation/i.test(message) &&
    /为什么|为何|没办法|不能|无法|点不了|灰|why|disabled|can.t|cannot/i.test(message);
  if (asksWhyEvacuationBlocked && state.standards && !snapshot.airlock?.authorized && !snapshot.unlocked) {
    const blockers = snapshot.coolingRestored
      ? Object.entries(SCAN_FIELDS).filter(([, field]) => !snapshot[field])
        .map(([route]) => phrase('还需扫描 {route} 通道。', {route}))
      : ['请先恢复备用冷却，再请求扫描。'];
    blockers.push(...missingStandards.map(id => PASSAGE_STANDARDS[id].location));
    if (state.routeReady === false) blockers.push('请先核验并暂存所选路线。');
    if (blockers.length) return answer(blockers.map(hint => translate(locale, hint)).join(' '), canScan);
    return answer(translate(locale, '在出口检测台点击「启动撤离」，进入缓冲舱。'));
  }
  const asksWhereReadings = recognizedIntent === 'readings_location' || /读数|扫描结果|readings|scan results/i.test(message) &&
    /哪|怎么走|where|how (?:do I|can I) get/i.test(message);
  if (asksWhereReadings) return answer(consoleDirections(), canScan);
  if (intent === 'confirm_pressure_criterion') {
    if (room !== 'service') return answer(translate(locale, '请在设备走廊确认压差线索。'));
    if (state.standards?.lights) return answer(translate(locale, '压差标准已经收入调查记录。'));
    const gauge = state.gauge;
    if (hasPressureBoundary(gauge)) {
      return answer(translate(locale, '实测记录与结论一致。已确认撤离压差上限。'), false, 'reply', true);
    }
    const missing = gauge?.calibrated !== true ? '请先完成压差表校零。'
      : gauge.noteFound !== true ? '请先查看检修盒便签。'
        : '请补测相邻的通过档和拒绝档。';
    return answer(translate(locale, missing));
  }
  const acknowledgesGauge = room === 'service' && !state.standards?.lights && hasPressureBoundary(state.gauge) &&
    /^(?:确认|确认了|收到|已收到|明白了|知道了|了解了|我知道了|我明白了|confirm(?:ed)?|got it|understood|acknowledged)[。！!？?]*$/i.test(message.trim());
  const confirmsGaugeTest = acknowledgesGauge || /^(?:请(?:帮我)?)?(?:确认|核对|记录)(?:一下)?(?:压差线索|(?:压差)?(?:验收)?(?:测试|实测)(?:结果|记录))[。！!？?]*$|^(?:please )?(?:confirm|verify|record) (?:the )?(?:pressure clue|(?:pressure )?test results)[.?!]*$/i.test(message.trim());
  const asksAboutGauge = room === 'service' && state.gauge && (
    /压差表|表针|校零|归零|撤离基准|验收测试|检修盒|便签|逐档|升压|等压|压差上限|(?:[AB].{0,6})压差|gauge|calibrat|zero|needle|pressure limit|reference mode|inspection box|worn note|test step|压差.{0,8}(?:上限|标准|≤|<=|不超过|小于等于)|(?:[0-9０-９一二三四五六]\s*档?\s*)(?:通过|拒绝|不通过|没通过)|\d+\s+(?:passed|failed|rejected)/i.test(message) ||
    confirmsGaugeTest || state.gauge.inspecting === true && step && !mainStep && !finishedClue);
  if (asksAboutGauge) {
    const {mode, calibrated, offset, noteFound, tested} = state.gauge;
    context.gauge = {
      inspecting: state.gauge.inspecting === true,
      mode: ['zero', 'reference'].includes(mode) ? mode : null,
      calibrated: calibrated === true,
      noteFound: noteFound === true,
      tested: Array.isArray(tested) ? [...new Set(tested.filter(tick => Number.isInteger(tick) && tick >= -4 && tick <= 6))] : [],
      offset: mode === 'zero' && Number.isInteger(offset) && offset >= -4 && offset <= 6 ? offset : null
    };
    const report = message.normalize('NFKC').replace(/[零一二三四五六]/g, digit => String('零一二三四五六'.indexOf(digit)));
    const passed = [...report.matchAll(/(?<![\d.-])(\d+)\s*(?:档|级)?\s*(?:可以|已|is\s+)?\s*(?:通过|合格|pass(?:ed|es)?)/gi)];
    const rejected = [...report.matchAll(/(?<![\d.-])(\d+)\s*(?:档|级)?\s*(?:被|is\s+)?\s*(?:拒绝|不通过|没通过|没有通过|未通过|不合格|reject(?:ed|s)?|fail(?:ed|s)?)/gi)];
    const declared = report.match(/(?:上限|压差标准|limit)\s*(?:是否为|是不是|是否是|是|为|is|of|[:=])?\s*(\d+)|(?<![\d.-])(\d+)\s*(?:档)?\s*(?:是|为|is)\s*(?:the\s+)?(?:撤离)?(?:压差)?(?:上限|limit)/i);
    const inequality = report.match(/压差\s*(?:≤|<=|不超过|小于等于|不大于)\s*([+-]?\d+)/i);
    const isReport = confirmsGaugeTest || declared || inequality || passed.length && rejected.length;
    if (isReport) {
      const matches = (!declared || Number(declared[1] ?? declared[2]) === PRESSURE_LIMIT) &&
        (!inequality || Number(inequality[1]) === PRESSURE_LIMIT);
      const matchesPair = !passed.length && !rejected.length || passed.some(match => Number(match[1]) === PRESSURE_LIMIT) &&
        rejected.some(match => Number(match[1]) === PRESSURE_LIMIT + 1);
      if (matches && matchesPair && hasPressureBoundary(context.gauge)) {
        return answer(translate(locale, '实测记录与结论一致。已确认撤离压差上限。'), false, 'reply', true);
      }
      return answer(translate(locale, '还无法确认。核对相邻的通过档和拒绝档，补测缺项后再汇报。'));
    }
    if (step || requestMode === 'demo') {
      const progress = context.gauge;
      if (step && state.standards?.lights === true) {
        return answer(translate(locale, '压差标准已经收入调查记录。'));
      }
      if (hasPressureBoundary(progress)) {
        return answer(translate(locale, '实测记录齐全。可以请我确认测试结果。'));
      }
      const hint = /检修盒|便签.{0,8}(?:哪|找)|inspection box|where.*note/i.test(message) || progress.calibrated && !progress.noteFound
        ? '检修盒在设备走廊左上角靠墙。走近后调查盒里的便签。'
        : progress.mode === 'reference'
          ? '找出相邻的通过档和拒绝档，再把结果或推得的压差上限告诉我。'
          : progress.calibrated ? '便签已经找到。切到验收测试，按便签从起始档逐档测试。'
            : progress.mode !== 'zero' ? '先切到校零档，接通内部等压回路。'
              : progress.offset === 0 ? '表针已对准零刻度，可以确认校零。'
                : progress.offset > 0 ? '表针在零刻度右侧，用减号往回调。'
                  : '表针在零刻度左侧，用加号往回调。';
      return answer(translate(locale, hint));
    }
  }
  const asksAboutPhoto = room === 'archive' && state.photo && (step && state.photo.inspecting === true && !mainStep && !finishedClue ||
    /合照|合影|相框|照片|连拍|回执|门缝|联锁验收|photo|snapshot|receipt|interlock test/i.test(message));
  if (asksAboutPhoto) {
    context.photo = {
      inspecting: state.photo.inspecting === true,
      frame: [1, 2, 3].includes(state.photo.frame) ? state.photo.frame : null,
      attempted: state.photo.attempted === true, receiptInspected: state.photo.receiptInspected === true, collected: state.standards?.photo === true
    };
    const asksPhotoPurpose = /^(?:(?:这个|这张|研究组)?(?:合照|合影|照片))\s*(?:是)?(?:做什么(?:的)?|有什么用|用来做什么|起什么作用)[？?。.!！]*$|^what is (?:the |this )?(?:team )?photo (?:for|used for)[?.!]*$/i.test(message.trim());
    const asksWhatPhotoIs = /^(?:研究组)?(?:合照|合影|照片)(?:是(?:什么)?)?[？?。.!！]*$/.test(message.trim());
    if (asksPhotoPurpose || asksWhatPhotoIs) {
      return answer(translate(locale, '合影背面夹着试运行连拍。可以放大照片，检查背景里的门控面板和测试回执。'));
    }
    if (step || requestMode === 'demo') {
      const {frame, collected} = context.photo;
      const asksDoorState = /门.{0,8}(?:开|关|合|缝)|door.{0,12}(?:open|closed|sealed)/i.test(message);
      const hint = frame !== null && asksDoorState
        ? frame === 1 ? '内门：仍有门缝，尚未关严' : '内门：已关严'
        : collected ? '联锁标准已经收入调查记录。'
        : frame === null ? '翻开相框夹层，选一张连拍放大背景里的门控面板。'
          : step && !context.photo.receiptInspected ? '点击放大照片右侧的联锁面板，查看测试回执。'
            : step && frame === 3 ? '已看到响应回执。请在合照面板提交你的判断。'
              : '内门关严和发送请求是两个中间状态。找一条能证明联锁已经回应的回执。';
      return answer(translate(locale, hint));
    }
  }
  const microscope = room === 'research' && state.microscope;
  const asksAboutMicroscope = microscope && (step && microscope.inspecting === true && !mainStep && !finishedClue ||
    /显微镜|紫光|焦距|对焦|调焦|光斑|亮斑|光圈|角标|计数框|参照区|气泡|实心|空心|参照片|我数了|校准.{0,8}(?:失败|没通过)|microscope|focus|violet|bubble|hollow|solid|counted|bright spot|corner marker|counting frame|reference area/i.test(message));
  if (asksAboutMicroscope) {
    const {violet, focused, aligned, lastCount} = microscope;
    context.microscope = {
      inspecting: microscope.inspecting === true,
      violet: violet === true, focused: violet === true && focused === true,
      aligned: violet === true && aligned === true,
      lastCount: [1, 2, 3].includes(lastCount) ? lastCount : null,
      collected: state.standards?.microscope === true
    };
    if (step || requestMode === 'demo') {
      const progress = context.microscope;
      const hint = progress.collected ? '颗粒标准已经收入调查记录。'
        : !progress.violet ? '先把显微镜切换到紫光，找到参照片上的计数框。'
          : !progress.aligned ? '用方向键移动计数框，对齐有金色角标的参照区。'
            : !progress.focused ? '试着用近焦或远焦调节，直到亮点边缘清晰。'
            : progress.lastCount !== null ? '重新检查计数框边界。框外亮点和空心光圈都不计入。'
              : '空心光圈是气泡。只数计数框内的实心亮点。';
      return answer(translate(locale, hint));
    }
  }
  const asksForStandards = recognizedIntent === 'clue_progress' || /还差|还缺|缺.{0,8}(?:线索|标准)|(?:标准|判读卡|检定标签|便签).{0,8}(?:哪|怎么找)|(?:哪|怎么找).{0,8}(?:标准|线索)|missing|where.*(?:criteria|standard|clue)/i.test(message);
  const scanBoth = recognizedIntent === 'scan_both' || /扫(?:描)?.*(?:两条|全部|[AB].*[AB])|(?:两条|全部|[AB].*[AB]).*扫|scan.*(?:both|all|[AB]\b.*\b[AB]\b)/i.test(message) &&
    !/怎么|如何|为什么|结果|读数|条件|how|why|results|readings/i.test(message);
  const secondaryScan = asksForStandards && message.match(/(?:顺便|再|也|also|then)[^。！!?]{0,12}(?:扫(?:描)?|scan)\s*(?:route\s*)?([AB])/i);
  if (recognizedIntent === 'scan_both' || recognizedIntent === 'clue_progress' ||
      (!asksAboutMicroscope && !asksAboutPhoto && !asksAboutGauge && state.standards && (asksForStandards || scanBoth))) {
    const named = Object.keys(PASSAGE_STANDARDS).filter(id => ({
      lights: /压差|pressure/i, microscope: /颗粒|显微镜|particle|microscope/i,
      photo: /联锁|合照|interlock|photo/i
    })[id].test(message));
    const clues = named.length ? named : missingStandards;
    const hint = clues.length ? clues.map(id => {
      const clue = PASSAGE_STANDARDS[id];
      return translate(locale, missingStandards.includes(id) ? clue.location : clue.reading);
    }).join(' ') : translate(locale, '三项通道验收标准均已收集。');
    const route = secondaryScan?.[1]?.toUpperCase();
    const action = scanBoth ? 'scan_route_both' : SCAN_ACTIONS[route];
    const scanning = action && canEchoAct(snapshot, action);
    const scanReply = route && !scanBoth
      ? scanning ? phrase('正在扫描 {route} 通道。', {route})
        : snapshot[SCAN_FIELDS[route]] ? phrase('{route} 通道扫描完成，读数已上传至出口检测台。', {route})
          : '请先恢复备用冷却，再请求扫描。'
      : scanning ? '正在扫描 A、B 两条通道。'
        : snapshot.scannedA && snapshot.scannedB ? 'A、B 通道扫描完成，读数已上传至出口检测台。'
          : '请先恢复备用冷却，再请求扫描。';
    return answer([asksForStandards && hint, action && translate(locale, scanReply)].filter(Boolean).join(' '),
      canScan, scanning ? action : 'reply');
  }
  if (state.standards && /读数|扫描结果|通道条件|readings|scan results/i.test(message) &&
      !/为什么|为何|为啥|\bwhy\b/i.test(message)) {
    const asked = message.match(/\b([AB])\s*(?:通道|route|passage)|(?:通道|route|passage)\s*([AB])\b/i);
    const routes = asked ? [(asked[1] ?? asked[2]).toUpperCase()] : Object.keys(SCAN_FIELDS);
    return answer(routes.map(route => {
      const readings = context.passage?.readings[route];
      return translate(locale, readings
        ? phrase('{route} 通道：压差 {pressure}，颗粒指数 {particles}，{interlock}。', {
          route, ...readings, interlock: readings.interlock ? '联锁响应' : '联锁无响应'
        })
        : phrase('{route} 通道尚无扫描读数。', {route}));
    }).join(' '), canScan);
  }
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
  const namedRoute = message.match(/\b([AB])\s*(?:通道|route|passage)|(?:通道|route|passage)\s*([AB])\b|(?:扫(?:描)?|\bscan)\s*(?:route\s*)?([AB])\b/i);
  const otherRoute = /另一条|剩下(?:的)?(?:那)?一条|the other (?:route|passage|one)/i.test(message);
  const choosesScan = routeOnly && canScan &&
    /(?:选择|指定).{0,16}(?:扫描|通道)|扫描\s*[AB]\s*通道|正在扫描|核验通道读数|\bwhich passage to scan\b|\bscan (?:route |passage )?[AB]\b|\bscanning (?:route |passage )?[AB]\b|check the (?:passage )?readings/i.test(lastReply);
  const modeledScan = Object.hasOwn(scanIntents, recognizedIntent) ? scanIntents[recognizedIntent] : undefined;
  if (modeledScan || choosesScan || (scanCommand.test(message.trim()) &&
      !/怎么|如何|为什么|标准|结果|\bhow\b|\bwhy\b/i.test(message))) {
    const route = modeledScan
      ? ['A', 'B'].includes(modeledScan) ? modeledScan : undefined
      : (routeOnly?.[1] ?? namedRoute?.[1] ?? namedRoute?.[2] ?? namedRoute?.[3])?.toUpperCase();
    const remaining = Object.keys(SCAN_FIELDS).filter(name => !snapshot[SCAN_FIELDS[name]]);
    const target = route ?? ((modeledScan ? modeledScan === 'other' : otherRoute)
      ? remaining.length === 1 ? remaining[0] : undefined
      : remaining.includes(incident.preferredScan) ? incident.preferredScan : remaining[0]);
    if (!snapshot.coolingRestored) return answer(translate(locale, '请先恢复备用冷却，再请求扫描。'));
    if (target && canEchoAct(snapshot, SCAN_ACTIONS[target])) {
      return answer(translate(locale, phrase('正在扫描 {route} 通道。', {route: target})), true, SCAN_ACTIONS[target]);
    }
    if (target && snapshot[SCAN_FIELDS[target]]) {
      return answer(translate(locale, phrase('{route} 通道扫描完成，读数已上传至出口检测台。', {route: target})), canScan);
    }
    if (!remaining.length) return answer(translate(locale, 'A、B 通道扫描完成，读数已上传至出口检测台。'));
    if (canScan) return answer(translate(locale, '可以请我扫描 A、B 两条通道，也可以指定其中一条。'), true);
  }
  const prop = /广播台|intercom/i.test(message) ? OBJECTS.intercom
    : /咖啡机|coffee machine|coffee maker/i.test(message) ? OBJECTS.coffee : null;
  if (prop) {
    const asksWhere = /哪|怎么走|怎么找|\bwhere\b|how.*(?:get|reach)/i.test(message);
    if (asksWhere) {
      const direction = room && room !== prop.room ? nextDoor(room, prop.room) : null;
      const nextRoom = direction && ROOMS[room].doors[direction];
      return answer(translate(locale, direction
        ? phrase('{prop}在{targetRoom}。从{location}的{direction}先进入{nextRoom}。', {
          prop: prop.title, targetRoom: ROOMS[prop.room].name, location: ROOMS[room].name,
          direction: directionNames[direction], nextRoom: ROOMS[nextRoom].name
        }) : phrase('{prop}在{targetRoom}。', {prop: prop.title, targetRoom: ROOMS[prop.room].name})));
    }
    return answer(translate(locale, prop === OBJECTS.intercom
      ? '控制室的广播台可以查看旧值班广播、播放提示音。'
      : '值班室的咖啡机可以冲咖啡。调查时还可以展开值班广播摘录，查看缓冲舱操作提示。'));
  }
  const asksForCard = /工作证|工牌|身份卡|staff ID|ID card/i.test(message) &&
    /在哪|哪里|哪儿|怎么找|去哪|\bwhere\b/i.test(message);
  if (asksForCard) {
    return answer(translate(locale, snapshot.card ? '工作证已收起。' : '工作证在研究室的办公桌上。'));
  }
  if ((step || locationQuestion.test(message.trim())) && context.objectiveDirection) {
    const heading = context.nextRoom === context.objectiveRoom
      ? '你现在在{location}，从{direction}出去就可以{objective}。'
      : '你现在在{location}，先从{direction}进入{nextRoom}，接下来要{objective}。';
    return answer(translate(locale, phrase(heading, {
      location: context.location, direction: context.objectiveDirection,
      nextRoom: context.nextRoom, objective: translate(locale, objective.label)
    })), canScan);
  }
  if (step && objective.target === 'exit' && !snapshot.airlock?.authorized) {
    return answer(translate(locale, '到撤离区的出口检测台核验通道读数。'), canScan);
  }
  if (step && objective.target === 'echo' && canScan && snapshot.scannedA !== snapshot.scannedB) {
    return answer(translate(locale, phrase('{done} 通道已扫描。主线下一步是扫描 {pending} 通道。', {
      done: snapshot.scannedA ? 'A' : 'B', pending: snapshot.scannedA ? 'B' : 'A'
    })) + ' ' + consoleDirections(), true);
  }
  if (scanHelp) return answer(translate(locale, '可以请我扫描 A、B 两条通道，也可以指定其中一条。'), true);
  if (step && objective.target === 'card') {
    return answer(translate(locale, '先到研究室办公桌拾取工作证。'));
  }
  if (step && objective.target === 'journal') {
    return answer(translate(locale, '查看研究室办公桌上的研究日志。'));
  }
  if (room && locationQuestion.test(message.trim())) {
    return answer(translate(locale, snapshot.airlock && airlockContext(snapshot.airlock).inChamber
      ? '你在撤离区的缓冲舱内。'
      : phrase('你在{location}。', {location: context.location})));
  }
  if (finishedClue) return answer(translate(locale, phrase('接下来，{objective}。', {
    objective: translate(locale, objective.label)
  })));
  const askedRoute = message.match(/([AB])\s*(?:通道|route)|(?:通道|route)\s*([AB])/i);
  if (askedRoute && /为什么|为何|为啥|\bwhy\b/i.test(message) && /通过|达标|合格|拒绝|pass|fail|reject/i.test(message)) {
    const route = (askedRoute[1] ?? askedRoute[2]).toUpperCase();
    const readings = context.passage?.readings[route];
    if (readings && (!state.standards || snapshot.unlocked)) return answer(translate(locale, describePassageCheck(route, readings)));
    if (readings) return answer(translate(locale, '请在出口检测台用已收集的标准逐项比对实测读数。'));
    return answer(translate(locale, '请先扫描通道，再到出口检测台查看读数。'));
  }
  if (step) {
    return answer(translate(locale, objective.label), canScan);
  }
  if (modelDecision) {
    return respondToDecision(response, fail, replyOnly(modelDecision.reply), snapshot, null, message, requestMode, verification, locale);
  }
  if (requestMode === 'demo') return respondToDecision(response, fail, demoDecision(snapshot, history, message, incident, locale, verification), snapshot, null, message, requestMode, verification, locale);
  const completionUrl = new URL(approvedApiBase + '/chat/completions');
  const usesDeepSeek = completionUrl.hostname === 'api.deepseek.com';
  const replyLanguage = locale === 'en' ? 'Write your reply in English.' : '请用简体中文回复。';
  const responseInstructions = instructions + '\n' + replyLanguage + ' 回复中的顺序请用文字表达，避免箭头符号。';
  const contextInstructions = `
最后一条消息由服务端以 JSON 发送。playerMessage 是玩家本轮原话，currentState 是服务端提供的本轮状态。核验玩家陈述时，本轮只把 playerMessage 视为玩家原话，结合规则允许使用的历史玩家陈述；currentState 是核对依据，不能充当玩家证据。
设备上下文中的 inspecting 为 true 表示本次通讯从该设备窗口打开。为 false 时，玩家可能只是在同一房间提问，设备字段是保留的操作记录，不能据此说玩家正在查看设备。
出现 currentState.gauge 时，玩家在问走廊压差表或检定便签。只能选择 reply。mode 为 zero 表示校零，reference 表示验收测试。校零时正偏移用减号，负偏移用加号。检修盒在设备走廊左上角靠墙，玩家须亲手调查磨损便签。根据 noteFound 和 tested 提示按便签逐档测试或补测跳过的档位，指导玩家向 ECHO 汇报相邻的通过档和拒绝档或推得的压差上限。不要报出上限或未测试档位的结果。验收测试用于找上限，两条通道的实测来自扫描。
出现 currentState.photo 时，玩家在问档案室连拍。只能选择 reply。frame 是当前放大的帧号，null 表示还未放大。第一帧内门仍有门缝，第二和第三帧内门已关严。玩家问当前照片里的门是否开着时，依据 frame 回答。结合 frame 和 attempted 提示玩家比较背景面板，说明内门关严、已发送请求、收到回执的区别。不要指出正确帧号；玩家需要亲手点选回执，并在合照面板提交它能证明的撤离条件。
出现 currentState.microscope 时，玩家在问显微镜。只能选择 reply。结合 violet、aligned、focused、lastCount、collected 给当前一步的提示。未对齐时提示移动计数框到金色角标所在区域。对齐并调清边缘后，只统计计数框内的实心亮点，空心光圈和框外亮点排除。可以解释玩家描述的现象，但不要确认或给出正确读数和颗粒阈值；由玩家提交读数，显微镜负责判定并记录。
回答前先区分玩家问的是含义、当前状态还是过去的经过。只问物件用途或线索细节时，围绕该问题回答。玩家询问位置、走法、目标或下一步时再提供主线指引。只问含义时只解释含义。问当前状态时，先读取 currentState 中对应的值；true、false 都是明确的值。历史仅用于理解指代或补充状态未覆盖的背景。旧回复或提问中的旧前提与本轮状态冲突时，按本轮状态回答。
问过去的经过或先后顺序时，参考 progressTimeline。atMs 是开局后的毫秒数，同一时间按数组顺序；changes 是变化后的字段值，room 是房间标识。缺少记录时说明无法确认。`;
  const messages = [
    {role: 'system', content: responseInstructions + '\n' + ECHO_STATE_GUIDE + contextInstructions + intentInstructions},
    ...history.map(({role, content}) => ({
      role,
      // History contains displayed dialogue. Current device progress comes from the state snapshot.
      content: role === 'assistant'
        ? JSON.stringify({reply: content, action: 'reply', verification_passed: false})
        : content
    })),
    {role: 'user', content: JSON.stringify({playerMessage: message, currentState: context,
      activeClue: state.gauge?.inspecting === true ? 'pressure'
        : state.photo?.inspecting === true ? 'interlock'
          : state.microscope?.inspecting === true ? 'particles' : null})}
  ];
  const completion = {model, messages, response_format: {type: 'json_object'}};
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
      if (usesDeepSeek && attempt === 0 && typeof content === 'string' && !trimmedContent) {
        messages[0].content = responseInstructions + '\n' + ECHO_STATE_GUIDE + contextInstructions + intentInstructions + '\n请直接输出包含四个字段的完整 JSON 对象。';
        completion.thinking = {type: 'enabled'};
        completion.reasoning_effort = 'low';
        completion.max_tokens = 2048;
        continue;
      }
      if (trimmedContent) {
        decision = JSON.parse(trimmedContent);
      }
    } catch {
      return fail(502, 'ECHO 返回了无效决策，请重试。');
    }
    break;
  }
  const modeledIntent = decision?.intent;
  if (['next_step', 'main_step', 'evacuation_blocked', 'clue_progress', 'readings_location',
    'scan_both', 'airlock_status', 'airlock_unclear'].includes(modeledIntent) ||
      Object.hasOwn(scanIntents, modeledIntent) || Object.hasOwn(airlockCommands, modeledIntent)) {
    return dispatchEcho(params, modeledIntent, decision);
  }
  if (Object.values(AIRLOCK_ACTIONS).includes(decision?.action)) {
    decision = replyOnly(translate(locale, '请说明切电时机：现在、进舱时，还是等内门关严后？'));
  }
  if ((asksAboutMicroscope || asksAboutPhoto || asksAboutGauge) && typeof decision?.reply === 'string') decision = replyOnly(decision.reply);
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
