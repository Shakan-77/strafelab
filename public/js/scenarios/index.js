import { CounterStrafe, StrafeShoot, AirCourse, MoveCourse, SilentJumps } from './movement.js';
import { StrafeBots, Micro, Macro, Sniper } from './aim.js';
import { Reaction, AngleHold } from './reaction.js';
import { PeekDuel } from './sim.js';
import { GridTaps, MultiTargetSwitch, StrafeTracking } from './target-practice.js';

/** Scenario id (matches data/scenarios.json) → implementation. */
export const SCENARIOS = {
  'counter-strafe': CounterStrafe,
  'strafe-shoot': StrafeShoot,
  'strafe-bots': StrafeBots,
  micro: Micro,
  macro: Macro,
  'grid-taps': GridTaps,
  'multi-switch': MultiTargetSwitch,
  'strafe-tracking': StrafeTracking,
  sniper: Sniper,
  reaction: Reaction,
  'angle-hold': AngleHold,
  'peek-duel': PeekDuel,
  'air-course': AirCourse,
  'move-course': MoveCourse,
  'silent-jump': SilentJumps,
};
