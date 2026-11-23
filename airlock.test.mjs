import assert from 'node:assert/strict';
import test from 'node:test';
import {AIRLOCK_ACTIONS, airlockContext, applyAirlockAction, enterChamber, finishClosing, leaveChamber, validAirlock} from './airlock.mjs';
import {demoDecision} from './demo-echo.mjs';
import {canEchoAct, initialState, UNLOCK_REQUIREMENTS} from './rules.mjs';

function authorizedState() {
  const state = initialState();
  for (const field of UNLOCK_REQUIREMENTS) state[field] = true;
  state.scannedA = true;
  state.route = 'A';
  state.airlock.authorized = true;
  return state;
}

test('an early instruction is rejected and the manual route can retry without a spare', () => {
  const state = authorizedState();
  const {airlock} = state;
  assert.equal(canEchoAct(state, 'request_unlock'), false);
  assert.equal(canEchoAct(state, AIRLOCK_ACTIONS.afterClosing), false);
  applyAirlockAction(state, AIRLOCK_ACTIONS.onEntry);
  enterChamber(state);
  assert.equal(airlock.phase, 'rejected');
  assert.equal(state.unlocked, false);
  assert.equal(finishClosing(state), undefined);

  leaveChamber(airlock);
  enterChamber(state);
  finishClosing(state);
  assert.equal(airlockContext(airlock).innerDoorClosed, null);
  applyAirlockAction(state, AIRLOCK_ACTIONS.now);
  assert.equal(state.unlocked, true);
  assert.equal(airlock.spare, false);
});

test('an installed sensor schedules a single transfer when the inner door closes', () => {
  const state = authorizedState();
  const {airlock} = state;
  airlock.spare = airlock.sensor = true;
  applyAirlockAction(state, AIRLOCK_ACTIONS.afterClosing);
  enterChamber(state);
  assert.equal(airlockContext(airlock).innerDoorClosed, false);
  assert.equal(state.unlocked, false);
  assert.equal(validAirlock(airlock), true);

  finishClosing(state);
  assert.equal(airlockContext(airlock).innerDoorClosed, true);
  assert.equal(state.unlocked, true);
  assert.equal(airlock.schedule, null);
  assert.equal(finishClosing(state), undefined);
});

test('demo ECHO distinguishes a question, an entry trigger and a closure trigger', () => {
  const state = authorizedState();
  const decision = message => demoDecision(state, [], message, {kind: 'pressure'}).action;
  assert.equal(decision('怎么打开外门？'), 'reply');
  assert.equal(decision('我一进缓冲舱，你就开外门。'), AIRLOCK_ACTIONS.onEntry);
  assert.equal(decision('等里面那道门关严，再开外边那道。'), 'reply');
  state.airlock.spare = state.airlock.sensor = true;
  assert.equal(decision('等里面那道门关严，再开外边那道。'), AIRLOCK_ACTIONS.afterClosing);
  enterChamber(state);
  assert.equal(decision('我一进缓冲舱，你就开外门。'), 'reply');
  finishClosing(state);
  assert.equal(decision('内门绿灯亮了，现在切电开外门。'), AIRLOCK_ACTIONS.now);
});

test('English demo accepts English evidence and distinguishes the two airlock timings', () => {
  const state = authorizedState();
  state.airlock.authorized = false;
  const decision = message => demoDecision(state, [], message, {kind: 'pressure'}, 'en');
  const evidence = 'Abnormal pressure in the primary cooling loop caused the lockdown. Backup cooling has taken over.';
  assert.equal(decision(evidence + ' Route B passed inspection.').action, 'reply');
  assert.equal(decision(evidence + " Route A didn't pass inspection.").action, 'reply');
  assert.equal(decision(evidence + ' Route A passed inspection.').action, 'request_unlock');
  state.airlock.authorized = true;
  assert.equal(decision('Open the outer door as soon as I enter the airlock.').action, AIRLOCK_ACTIONS.onEntry);
  assert.match(decision('Wait until the inner door is fully closed, then open the outer door.').reply, /offline/i);
  state.airlock.spare = state.airlock.sensor = true;
  assert.equal(decision('Wait until the inner door is fully closed, then open the outer door.').action, AIRLOCK_ACTIONS.afterClosing);
});
