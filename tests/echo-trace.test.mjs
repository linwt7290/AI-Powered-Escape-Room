import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {createInterface} from 'node:readline';
import test from 'node:test';
import {AIRLOCK_ACTIONS} from '../shared/airlock.mjs';
import {API_PATHS} from '../shared/api-paths.mjs';
import {initialState, UNLOCK_REQUIREMENTS} from '../shared/rules.mjs';

test('ECHO preserves model messages and decisions through server rules', async t => {
  const requests = [];
  const scheduleWithoutIntent = {
    action: AIRLOCK_ACTIONS.afterClosing,
    reply: '我会在内门关严后切电。',
    verification_passed: false
  };
  const schedule = {...scheduleWithoutIntent, intent: 'airlock_after_close'};
  const recover = {
    intent: 'conversation',
    action: 'recover_archive',
    reply: '我会尝试恢复时序存档。',
    verification_passed: false
  };
  const upstream = createServer(async (request, response) => {
    let body = '';
    request.setEncoding('utf8');
    for await (const chunk of request) body += chunk;
    const {messages} = JSON.parse(body);
    requests.push(messages);
    const {playerMessage} = JSON.parse(messages.at(-1).content);
    const decision = playerMessage.includes('存档') ? recover
      : ['等内门关严后再切电打开外门。', '帮我开门。'].includes(playerMessage) ? schedule : scheduleWithoutIntent;
    response.writeHead(200, {'Content-Type': 'application/json'});
    response.end(JSON.stringify({
      model: 'fixture-model',
      choices: [{message: {content: JSON.stringify(decision)}}]
    }));
  });
  upstream.listen(0, '127.0.0.1');
  t.after(() => upstream.close());
  await once(upstream, 'listening');

  const env = {...process.env, ECHO_PORT: '0', ECHO_API_KEY: 'fixture-key',
    ECHO_API_BASE: 'http://127.0.0.1:' + upstream.address().port, ECHO_MODEL: 'fixture-model'};
  delete env.PORT;
  const game = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('../', import.meta.url), env, stdio: ['ignore', 'pipe', 'inherit']
  });
  const lines = createInterface({input: game.stdout});
  t.after(() => {
    lines.close();
    game.kill();
  });
  const [startup] = await once(lines, 'line', {signal: AbortSignal.timeout(5000)});
  const base = startup.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
  assert.ok(base, startup);

  async function send(state, room, message) {
    const response = await fetch(base + API_PATHS.echo, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({state, room, message, history: [],
        incident: {kind: 'pump', preferredScan: 'A', safeRoute: 'A'}}),
      signal: AbortSignal.timeout(5000)
    });
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    return payload;
  }

  const archive = {...initialState(), card: true, journal: true, rack: true};
  const restored = await send(archive, 'archive', '请帮我修复机柜里的时序存档。');
  assert.deepEqual(restored.messages, requests[0]);
  assert.deepEqual(restored.modelDecision, recover);
  assert.equal(restored.decision.action, 'recover_archive');

  const state = initialState();
  for (const field of UNLOCK_REQUIREMENTS) {
    if (field !== 'passageSafe') state[field] = true;
  }
  Object.assign(state, {scannedA: true, scannedB: true, selectedRoute: 'A',
    standards: {lights: true, microscope: true, photo: true}});
  Object.assign(state.airlock, {authorized: true, spare: true});
  const message = '等内门关严后再切电打开外门。';

  const offline = await send(state, 'exit', message);
  assert.deepEqual(offline.messages, requests[1]);
  assert.deepEqual(offline.modelDecision, schedule);
  assert.equal(offline.decision.action, 'reply');

  state.airlock.sensor = true;
  const online = await send(state, 'exit', message);
  assert.deepEqual(online.messages, requests[2]);
  assert.deepEqual(online.modelDecision, schedule);
  assert.equal(online.decision.action, AIRLOCK_ACTIONS.afterClosing);
  assert.equal(online.model, 'fixture-model');

  const recovered = await send(state, 'exit', '内门完全闭合后再把电源交给外门。');
  assert.deepEqual(recovered.messages, requests[3]);
  assert.deepEqual(recovered.modelDecision, scheduleWithoutIntent);
  assert.equal(recovered.decision.action, AIRLOCK_ACTIONS.afterClosing);

  const english = await send(state, 'exit', 'Please wait until the inner door is fully closed, then switch power.');
  assert.equal(english.decision.action, AIRLOCK_ACTIONS.afterClosing);
  const greenLight = await send(state, 'exit', '等联锁灯变绿了再切电。');
  assert.equal(greenLight.decision.action, AIRLOCK_ACTIONS.afterClosing);

  state.airlock.sensor = false;
  const unavailable = await send(state, 'exit', '请等内门关严后再切电打开外门。');
  assert.equal(unavailable.decision.action, 'reply');
  assert.match(unavailable.decision.reply, /传感器离线/);
  state.airlock.sensor = true;

  const entry = await send(state, 'exit', '我一进缓冲舱就切电打开外门。');
  assert.equal(entry.decision.action, AIRLOCK_ACTIONS.onEntry);

  for (const message of ['等内门关严后再切电吗？', '等内门关严后也别切电。']) {
    const clarification = await send(state, 'exit', message);
    assert.equal(clarification.decision.action, 'reply');
  }
  const ambiguous = await send(state, 'exit', '帮我开门。');
  assert.equal(ambiguous.modelDecision.intent, 'airlock_after_close');
  assert.match(ambiguous.decision.reply, /请说明切电时机/);

  state.airlock.phase = 'closed';
  const closed = await send(state, 'exit', '请等内门关严后再切电。');
  assert.equal(closed.decision.action, AIRLOCK_ACTIONS.now);
  assert.deepEqual(closed.modelDecision, scheduleWithoutIntent);
  const beforeImmediate = requests.length;
  const immediate = await send(state, 'exit', '现在切电');
  assert.equal(immediate.decision.action, AIRLOCK_ACTIONS.now);
  assert.equal(immediate.messages, null);
  assert.equal(immediate.modelDecision, null);
  assert.equal(immediate.model, null);
  assert.equal(requests.length, beforeImmediate);
});
