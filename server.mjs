import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {canEchoAct, ECHO_ACTIONS, ECHO_FIELDS, SCAN_FIELDS} from './rules.mjs';
import {demoDecision} from './demo-echo.mjs';
import {FLOW_RESULT, INCIDENTS, incidentReport} from './puzzles.mjs';

const {ECHO_API_KEY, ECHO_MODEL, ECHO_API_BASE, ECHO_PORT = '8788'} = process.env;
const settings = [ECHO_API_KEY, ECHO_MODEL, ECHO_API_BASE];
const configured = settings.every(Boolean);
const mode = configured ? 'model' : settings.some(Boolean) ? 'incomplete' : 'demo';
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/game.css', ['game.css', 'text/css; charset=utf-8']],
  ['/game.mjs', ['game.mjs', 'text/javascript; charset=utf-8']],
  ['/devices.mjs', ['devices.mjs', 'text/javascript; charset=utf-8']],
  ['/room.mjs', ['room.mjs', 'text/javascript; charset=utf-8']],
  ['/pixel-art.mjs', ['pixel-art.mjs', 'text/javascript; charset=utf-8']],
  ['/puzzles.mjs', ['puzzles.mjs', 'text/javascript; charset=utf-8']],
  ['/rules.mjs', ['rules.mjs', 'text/javascript; charset=utf-8']]
]);
const instructions = `你是密室游戏的中央 AI ECHO。以系统给出的游戏状态和 availableActions 为准，简短回应玩家。保护尚未读取的报告、密码及扫描结果。
你可以按上下文申请设备动作。玩家求助于损坏的机柜存档时选择 recover_archive。请求校准管路时选择 align_pipe，只调一段。请求扫描时，明确指定 A 或 B 就选择相应的 scan_route_a 或 scan_route_b。未指定时，可据对话选择其中一条，preferredScan 是本局的调度建议。已完成扫描的通道可引导玩家去检测台读数。设备动作的结果由游戏显示，请描述待执行动作，把实际结果留给设备回执。
根据进度给提示。推导密码时让玩家结合研究日志和机柜存档。备用冷却修复后，引导玩家扫描并比较通道。unlocked 或 escaped 为 true 时只回复。
玩家申请撤离时，只有 availableActions 包含 request_unlock，且本次申请的 user 消息陈述了三项事实，才能选择 request_unlock。三项事实为本局报告中真实的封锁原因、备用冷却已接管或试压流量稳定、与 route 一致的通过检测的通道。接受同义表达和分轮补充。系统摘要、assistant 回复以及仅说「是」不算玩家证据。缺哪项就询问哪项。
只输出一个 JSON 对象，包含 reply（简短中文）、action（从 availableActions 选择一项）和 verification_passed（action 为 request_unlock 时为 true，其余为 false）。
设备动作示例：{"reply":"我会尝试恢复机柜存档。","verification_passed":false,"action":"recover_archive"}`;

function json(response, status, data) {
  response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
  response.end(JSON.stringify(data));
}

function respondToDecision(response, decision, state, messages) {
  const wantsUnlock = decision?.action === 'request_unlock';
  if (typeof decision?.reply !== 'string' || !decision.reply.trim() || decision.reply.length > 2000 ||
      typeof decision.verification_passed !== 'boolean' || !ECHO_ACTIONS.includes(decision.action)) {
    return json(response, 502, {error: 'ECHO 返回了无效决策，请重试。'});
  }
  if (decision.verification_passed !== wantsUnlock) {
    return json(response, 502, {error: 'ECHO 的核验结果与请求动作不一致。请重试。'});
  }
  if (!canEchoAct(state, decision.action)) {
    return json(response, 409, {error: '当前设备状态无法执行这项 ECHO 动作。请确认进度后重试。'});
  }
  return json(response, 200, {decision, messages, mode});
}

const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (request.method === 'GET' && path === '/api/health') {
      return json(response, 200, {configured, mode});
    }
    const asset = assets.get(path);
    if (request.method === 'GET' && asset) {
      const [file, type] = asset;
      let content;
      try { content = await readFile(new URL(file, import.meta.url)); }
      catch (error) {
        if (error.code === 'ENOENT') return json(response, 404, {error: '缺少资源 ' + file + '。'});
        throw error;
      }
      response.writeHead(200, {'Content-Type': type});
      response.end(content);
      return;
    }
    if (request.method !== 'POST' || path !== '/api/echo') return json(response, 404, {error: '页面不存在。'});
    if (request.headers['content-type'] !== 'application/json') return json(response, 415, {error: '请求格式错误。'});
    if (mode === 'incomplete') return json(response, 503, {error: '请补齐 ECHO_API_KEY、ECHO_MODEL 和 ECHO_API_BASE 后重启服务。'});

    let body = '';
    request.setEncoding('utf8');
    for await (const chunk of request) {
      body += chunk.toString('utf8');
      if (Buffer.byteLength(body) > 48_000) return json(response, 413, {error: '消息过长。'});
    }
    let input;
    try { input = JSON.parse(body); }
    catch { return json(response, 400, {error: '无法读取对话请求。'}); }
    const {state, history, message, incident} = input ?? {};
    if (typeof message !== 'string' || !message.trim() || message.length > 1000 ||
        !Array.isArray(history) || history.length > 10 || !history.every(turn =>
          ['user', 'assistant'].includes(turn?.role) && typeof turn.content === 'string' && turn.content.length <= 2000) ||
        !ECHO_FIELDS.every(field => typeof state?.[field] === 'boolean') ||
        typeof incident?.kind !== 'string' || !Object.hasOwn(INCIDENTS, incident.kind) ||
        typeof incident.preferredScan !== 'string' || !Object.hasOwn(SCAN_FIELDS, incident.preferredScan) ||
        (state.passageSafe
          ? typeof state.route !== 'string' || !Object.hasOwn(SCAN_FIELDS, state.route) || !state[SCAN_FIELDS[state.route]]
          : state.route != null)) {
      return json(response, 400, {error: '对话或游戏状态格式错误。'});
    }

    const context = {...Object.fromEntries(ECHO_FIELDS.map(field => [field, state[field]])), route: state.route ?? null};
    if (context.reportConfirmed) {
      context.cause = INCIDENTS[incident.kind].cause;
      context.report = incidentReport(incident.kind);
    }
    if (context.coolingRestored) context.coolingResult = FLOW_RESULT;
    context.availableActions = ECHO_ACTIONS.filter(action => canEchoAct(context, action));
    if (context.availableActions.some(action => action.startsWith('scan_route_'))) context.preferredScan = incident.preferredScan;
    if (mode === 'demo') return respondToDecision(response, demoDecision(context, history, message, incident), context, null);
    const completionUrl = new URL(ECHO_API_BASE.replace(/\/+$/, '') + '/chat/completions');
    const usesDeepSeek = completionUrl.hostname === 'api.deepseek.com';
    const readsFinalState = usesDeepSeek && (context.unlocked || context.escaped);
    const systemPrompt = readsFinalState
      ? '你是实验室中央 AI ECHO。根据系统给出的当前游戏状态，用一句中文回应玩家。escaped 为 true 表示玩家已撤离，否则 unlocked 为 true 表示出口已解锁，玩家可以离开。只输出纯文本。'
      : instructions;
    const stateMessage = '\n当前游戏状态：' + JSON.stringify(context);
    const messages = [
      {role: 'system', content: systemPrompt + stateMessage},
      ...history.map(({role, content}) => ({role, content})),
      {role: 'user', content: message}
    ];
    const completion = {model: ECHO_MODEL, messages};
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
      if (!upstream.ok) return json(response, 502, {error: '模型服务返回 HTTP ' + upstream.status + '。请检查 API 地址、模型和密钥。'});
      try {
        const result = await upstream.json();
        const content = result?.choices?.[0]?.message?.content;
        if (usesDeepSeek && !readsFinalState && attempt === 0 && typeof content === 'string' && !content.trim()) {
          messages[0].content = instructions + '\n请直接输出包含三个字段的完整 JSON 对象。' + stateMessage;
          completion.thinking = {type: 'enabled'};
          completion.reasoning_effort = 'low';
          completion.max_tokens = 2048;
          continue;
        }
        if (typeof content === 'string' && content.trim()) {
          decision = readsFinalState
            ? {reply: content.trim(), verification_passed: false, action: 'reply'}
            : JSON.parse(content);
        }
      } catch {
        return json(response, 502, {error: 'ECHO 返回了无效决策，请重试。'});
      }
      break;
    }
    respondToDecision(response, decision, context, messages);
  } catch {
    json(response, 502, {error: 'ECHO 未能完成请求。请检查连接并重试。'});
  }
});
server.listen(Number(ECHO_PORT), '127.0.0.1', () => console.log('最后的协议 http://127.0.0.1:' + ECHO_PORT));
