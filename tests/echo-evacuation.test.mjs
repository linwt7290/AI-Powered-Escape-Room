import assert from 'node:assert/strict';
import test from 'node:test';
import {demoDecision, verifyEvacuation} from '../backend/demo-echo.mjs';
import {PARTICLE_LIMIT, passageFailures, passageReadings, PRESSURE_LIMIT, safePassage} from '../shared/puzzles.mjs';
import {progressSnapshot, validProgressTimeline} from '../shared/progress-timeline.mjs';
import {initialState, UNLOCK_REQUIREMENTS} from '../shared/rules.mjs';

test('ECHO requires player evidence for all three evacuation checks', () => {
  const state = initialState();
  for (const field of UNLOCK_REQUIREMENTS) state[field] = true;
  Object.assign(state, {route: 'B', scannedA: true, scannedB: true});
  const incident = {kind: 'interlock', preferredScan: 'A', safeRoute: 'B'};
  const history = [
    {role: 'user', content: 'B 通道通过检测。'},
    {role: 'assistant', content: '备用冷却已接管，试压流量稳定。'}
  ];
  const cause = '主冷却联锁信号丢失，触发紧急封锁。';
  const decision = demoDecision(state, history, cause, incident);
  assert.equal(decision.action, 'reply');
  assert.match(decision.reply, /维修间/);

  const saved = verifyEvacuation(state, ['B 通道通过检测。'], cause, incident);
  assert.deepEqual(saved.missing, [1]);
  assert.deepEqual(verifyEvacuation(state, saved.evidence, '试压流量稳定吗？', incident).missing, [1]);
  assert.deepEqual(verifyEvacuation(state, saved.evidence, '备用冷却还没接管。', incident).missing, [1]);
  const complete = verifyEvacuation(state, saved.evidence, '试压流量稳定。', incident);
  assert.deepEqual(complete.missing, []);
  assert.equal(demoDecision(state, [], '试压流量稳定。', incident, undefined, complete).action, 'request_unlock');
});

test('passage failures use the same limits as registration', () => {
  assert.deepEqual(passageFailures(passageReadings('interlock', false)), ['interlock']);
  assert.deepEqual(passageFailures(passageReadings('pressure', false)), ['pressure']);
  assert.deepEqual(passageFailures(passageReadings('pump', false)), ['particles']);
  assert.equal(safePassage({pressure: PRESSURE_LIMIT, particles: PARTICLE_LIMIT, interlock: true}), true);
});


test('airlock progress snapshots produce changes accepted by the ECHO API', () => {
  const state = initialState();
  const before = progressSnapshot(state, 'exit');
  state.airlock.authorized = true;
  state.airlock.phase = 'closed';
  const after = progressSnapshot(state, 'exit');
  const changes = Object.fromEntries(Object.entries(after).filter(([field, value]) => before[field] !== value));
  assert.deepEqual(changes, {'airlock.authorized': true, 'airlock.inChamber': true});
  assert.equal(validProgressTimeline([{atMs: 100, changes}]), true);
});
