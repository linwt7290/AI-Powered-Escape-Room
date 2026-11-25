import assert from 'node:assert/strict';
import test from 'node:test';
import {DOORS, EXIT, move, nearbyObject, nextDoor, OBJECTS, PASSAGE_LANES, REPORT_FRAGMENTS, ROOMS} from '../shared/room.mjs';
import {currentObjective, initialState} from '../shared/rules.mjs';
import {demoDecision} from '../backend/demo-echo.mjs';

const opposites = {north: 'south', south: 'north', east: 'west', west: 'east'};
const offsets = {north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0]};

test('every room doorway can be crossed and has a usable return doorway', () => {
  for (const [room, {doors, position: [column, row]}] of Object.entries(ROOMS)) {
    for (const [side, destination] of Object.entries(doors)) {
      const [horizontal, vertical] = offsets[side];
      assert.deepEqual(ROOMS[destination].position, [column + horizontal, row + vertical]);
      const {axis, boundary, center, sign, arrival} = DOORS[side];
      const player = axis === 'x' ? {room, x: boundary, y: center} : {room, x: center, y: boundary};
      const dx = axis === 'x' ? sign : 0;
      const dy = axis === 'y' ? sign : 0;
      assert.equal(move(player, dx, dy), true);
      assert.equal(player.room, destination);
      assert.equal(player[axis], arrival);
      assert.equal(ROOMS[destination].doors[opposites[side]], room);
      for (let step = 0; step < 20 && player.room === destination; step++) move(player, -dx, -dy);
      assert.equal(player.room, room);
    }
  }
});

test('the control room has four exits and both loops offer an alternate route', () => {
  assert.deepEqual(Object.keys(ROOMS.control.doors).sort(), ['east', 'north', 'south', 'west']);
  const alternateRoutes = [
    ['research', 'control', 'service', 'duty', 'research'],
    ['control', 'archive', 'exit', 'maintenance', 'control']
  ];
  for (const loop of alternateRoutes) {
    for (let index = 0; index < loop.length - 1; index++) {
      assert(Object.values(ROOMS[loop[index]].doors).includes(loop[index + 1]));
    }
  }
});

test('objects can only be investigated in their assigned room', () => {
  const {x, y} = OBJECTS.rack;
  assert.equal(nearbyObject({room: 'archive', x, y}, {}), 'rack');
  assert.equal(nearbyObject({room: 'control', x, y}, {}), undefined);
});

test('task directions follow the connected rooms, even after taking a detour', () => {
  assert.equal(nextDoor('duty', 'archive'), 'north');
  assert.equal(nextDoor('service', 'archive'), 'north');
  assert.equal(nextDoor('research', 'archive'), 'east');
  assert.equal(nextDoor('archive', 'archive'), undefined);
});

test('the objective points to the next needed interaction when clues are found out of order', () => {
  const state = initialState();
  const target = () => currentObjective(state).target;
  state.rack = true;
  assert.equal(target(), 'card');
  state.card = true;
  assert.equal(target(), 'journal');
  state.journal = true;
  assert.equal(target(), 'echo');
  state.archiveRecovered = true;
  assert.equal(target(), 'terminal');
  state.airlock.authorized = true;
  assert.equal(target(), 'exit');
  state.unlocked = true;
  state.route = 'B';
  assert.equal(target(), 'lane');
  state.escaped = true;
  assert.equal(target(), undefined);
});

test('exterior access is restricted to the released lane in the evacuation room', () => {
  const player = {room: 'research', x: PASSAGE_LANES.A.center, y: 72};
  assert.equal(move(player, 0, -1, 'A'), false);
  player.room = 'exit';
  assert.equal(move(player, 0, -1, 'B'), false);
  while (player.y > EXIT.threshold) assert.equal(move(player, 0, -1, 'A'), true);
});

test('ECHO can bypass a diagnosed leak without reported coordinates', () => {
  const state = {...initialState(), card: true, journal: true, rack: true, archiveRecovered: true,
    identity: true, password: true, reportConfirmed: true, coupler: true};
  const decide = message => demoDecision(state, [], message, {kind: 'pressure'});
  assert.equal(decide('帮我解决掉压。').action, 'reply');
  state.coolingFaultRow = 1;
  assert.equal(decide('怎么修复掉压？').action, 'reply');
  assert.equal(decide('帮我解决掉压。').action, 'isolate_pipe');
  assert.equal(decide('改错').action, 'isolate_pipe');
  assert.equal(decide('Please fix the leak.').action, 'isolate_pipe');
});

test('report fragments become collectible after the password and then lead back to the terminal', () => {
  const state = {...initialState(), card: true, journal: true, rack: true, archiveRecovered: true, identity: true};
  for (const [key, {room, x, y}] of Object.entries(REPORT_FRAGMENTS)) {
    const player = {room, x, y};
    state.password = false;
    assert.notEqual(nearbyObject(player, state), key);
    state.password = true;
    assert.equal(currentObjective(state).target, key);
    assert.equal(nearbyObject(player, state), key);
    state.reportFragments.push(key);
    assert.notEqual(nearbyObject(player, state), key);
  }
  assert.equal(currentObjective(state).target, 'terminal');
  assert.equal(state.reportConfirmed, false);
});

test('the service corridor inspection box blocks movement and remains reachable', () => {
  const player = {room: 'service', x: 76, y: 89};
  assert.equal(move(player, 0, -2), false);
  assert.equal(nearbyObject(player, initialState()), 'inspectionBox');
  assert.equal(move(player, 0, 2), true);
});
