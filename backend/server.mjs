import {DEFAULT_LOCALE, phrase, translate} from '../shared/i18n.mjs';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {loadEnvFile} from 'node:process';
import {fileURLToPath} from 'node:url';
import {canEchoAct, ECHO_ACTIONS, ECHO_FIELDS, pipeCoordinates, SCAN_FIELDS, UNLOCK_REQUIREMENTS, validPipeNumber} from '../shared/rules.mjs';
import {demoDecision} from './demo-echo.mjs';
import {FLOW_RESULT, INCIDENTS, incidentReport} from '../shared/puzzles.mjs';
import {airlockContext, validAirlock} from '../shared/airlock.mjs';
import {API_PATHS} from '../shared/api-paths.mjs';
import {validProgressTimeline} from '../shared/progress-timeline.mjs';
import {ROOMS} from '../shared/room.mjs';

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
如果无法回答玩家的问题，选择 reply 动作，并在 reply 字段中写「我不知道」。
你可以按上下文申请设备动作。玩家求助于损坏的机柜存档时选择 recover_archive。请求校准管路时选择 align_pipe，只调一段。请求扫描时，明确指定 A 或 B 就选择相应的 scan_route_a 或 scan_route_b。未指定时，可据对话选择其中一条，preferredScan 是本局的调度建议。已完成扫描的通道可引导玩家去检测台读数。设备动作的结果由游戏显示，请描述待执行动作，把实际结果留给设备回执。
根据进度给提示。推导密码时让玩家结合研究日志和机柜存档。备用冷却修复后，引导玩家扫描并比较通道。unlocked 或 escaped 为 true 时只回复。
研究室有工作证与研究日志，控制室有安全终端，档案室有机柜存档，维修间有备用冷却与备件柜，撤离区有检测台。location 是玩家所在的房间。有需要时按这张门牌图引路：${roomLayout}。
玩家申请撤离时，只有 availableActions 包含 request_unlock，且本次申请的 user 消息陈述了三项事实，才能选择 request_unlock。三项事实为本局报告中真实的封锁原因、备用冷却已接管或试压流量稳定、与 route 一致的通过检测的通道。接受同义表达和分轮补充。系统摘要、assistant 回复以及仅说「是」不算玩家证据。缺哪项就询问哪项。
状态含 airlock 时，request_unlock 只签发缓冲舱授权，外门仍关闭。授权后，你能切换门控电源，备用电源一次只能供一道门。open_outer_on_entry 表示玩家明确要求一进舱就切电；open_outer_after_inner_closed 表示明确要求等内门关严或联锁灯变绿后再切电，且该动作需要传感器在线。open_outer_now 表示玩家明确要求立刻切电，或已给出等待条件且传感器确认 innerDoorClosed=true。保留玩家指定的触发时机。只谈「怎么」或「为什么」、询问日志、未要求执行或时机有歧义时只回复。对于「怎么打开外门？」之类的宽泛求助，如果玩家还没有提到日志、联锁失败、内门或指示灯，只引导去读检测台旁的旧门控日志，不透露正确指示灯颜色和切电条件。玩家引用具体线索或描述试验结果后，可以解释它。innerDoorClosed=null 时你看不到内门，也不能承诺自动等待门关严。可以由玩家观察现场指示灯后要求立即切电。若玩家要求「进舱就切电」，登记其指令，是否被联锁拒绝以设备回执为准。
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

function respondToDecision(response, fail, decision, state, messages, playerMessage, mode) {
  const wantsUnlock = decision?.action === 'request_unlock';
  if (typeof decision?.reply !== 'string' || !decision.reply.trim() || decision.reply.length > 2000 ||
      typeof decision.verification_passed !== 'boolean' || !ECHO_ACTIONS.includes(decision.action)) {
    return fail(502, 'ECHO 返回了无效决策，请重试。');
  }
  if (decision.verification_passed !== wantsUnlock) {
    return fail(502, 'ECHO 的核验结果与请求动作不一致。请重试。');
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
  return json(response, 200, {decision, messages, mode});
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
  const {state, history, message, incident, room, echoSettings, progressTimeline} = input ?? {};
  const effective = resolveEchoSettings(echoSettings);
  if (effective.error) return fail(effective.status, effective.error);
  const {mode: requestMode, model} = effective;
  if (configOnly) return json(response, 200, {mode: requestMode});
  if (requestMode === 'incomplete') return fail(503, '请补齐 ECHO_API_KEY、ECHO_MODEL 和 ECHO_API_BASE 后重启服务。');
  if (typeof message !== 'string' || !message.trim() || message.length > 1000 ||
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
      (state.passageSafe
        ? typeof state.route !== 'string' || !Object.hasOwn(SCAN_FIELDS, state.route) || !state[SCAN_FIELDS[state.route]]
        : state.route != null)) {
    return fail(400, '对话或游戏状态格式错误。');
  }

  const snapshot = {...Object.fromEntries(ECHO_FIELDS.map(field => [field, state[field]])), route: state.route ?? null};
  if (state.airlock) snapshot.airlock = state.airlock;
  if (Object.hasOwn(state, 'coolingFaultRow')) snapshot.coolingFaultRow = state.coolingFaultRow;
  const context = {...snapshot};
  if (progressTimeline?.length) {
    context.progressTimeline = progressTimeline.map(({atMs, changes}) => ({atMs, changes}));
  }
  if (room) context.location = ROOMS[room].name;
  if (snapshot.airlock) context.airlock = airlockContext(snapshot.airlock);
  if (context.reportConfirmed) {
    context.cause = translate(locale, INCIDENTS[incident.kind].cause);
    context.report = incidentReport(incident.kind, locale);
  }
  if (context.coolingRestored) context.coolingResult = translate(locale, FLOW_RESULT);
  context.availableActions = ECHO_ACTIONS.filter(action => canEchoAct(snapshot, action));
  if (context.availableActions.some(action => action.startsWith('scan_route_'))) context.preferredScan = incident.preferredScan;
  if (requestMode === 'demo') return respondToDecision(response, fail, demoDecision(snapshot, history, message, incident, locale), snapshot, null, message, requestMode);
  const completionUrl = new URL(approvedApiBase + '/chat/completions');
  const usesDeepSeek = completionUrl.hostname === 'api.deepseek.com';
  const readsFinalState = usesDeepSeek && (context.unlocked || context.escaped);
  const replyLanguage = locale === 'en' ? 'Write your reply in English.' : '请用简体中文回复。';
  const responseInstructions = instructions + '\n' + replyLanguage + ' 回复中的顺序请用文字表达，避免箭头符号。';
  const systemPrompt = readsFinalState
    ? '你是实验室中央 AI ECHO。根据系统给出的当前游戏状态，用一句话回应玩家。escaped 为 true 表示玩家已撤离，否则 unlocked 为 true 表示出口已解锁，玩家可以离开。只输出纯文本。' + replyLanguage
    : responseInstructions;
  const contextInstructions = `
最后一条消息由服务端以 JSON 发送。playerMessage 是玩家本轮原话，currentState 是服务端提供的本轮状态。核验玩家陈述时，本轮只把 playerMessage 视为玩家原话，结合规则允许使用的历史玩家陈述；currentState 是核对依据，不能充当玩家证据。
回答前先区分玩家问的是含义、当前状态还是过去的经过。只问含义时只解释含义。问当前状态时，先读取 currentState 中对应的值；true、false 都是明确的值。历史仅用于理解指代或补充状态未覆盖的背景。旧回复或提问中的旧前提与本轮状态冲突时，按本轮状态回答。
问过去的经过或先后顺序时，参考 progressTimeline。atMs 是开局后的毫秒数，同一时间按数组顺序；changes 是变化后的字段值，room 是房间标识。缺少记录时说明无法确认。`;
  const messages = [
    {role: 'system', content: systemPrompt + contextInstructions},
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
        messages[0].content = responseInstructions + contextInstructions + '\n请直接输出包含三个字段的完整 JSON 对象。';
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
  respondToDecision(response, fail, decision, snapshot, messages, message, requestMode);
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
