import assert from 'node:assert/strict';
import test from 'node:test';
import {DOORS, EXIT, move, nearbyObject, OBJECTS, PASSAGE_LANES, ROOMS} from './room.mjs';

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

test('exterior access is restricted to the released lane in the evacuation room', () => {
  const player = {room: 'research', x: PASSAGE_LANES.A.center, y: 72};
  assert.equal(move(player, 0, -1, 'A'), false);
  player.room = 'exit';
  assert.equal(move(player, 0, -1, 'B'), false);
  while (player.y > EXIT.threshold) assert.equal(move(player, 0, -1, 'A'), true);
});
