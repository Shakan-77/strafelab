/** Guide content: what each mechanic is, why it matters in Valorant, and which drill trains it. */
export const GUIDE = [
  {
    title: 'Counter-strafing',
    drill: 'counter-strafe',
    body: 'Valorant rifles have a movement accuracy cutoff at 27.5% of run speed. In StrafeLab, pressing the opposite key from full rifle speed crosses that threshold in about 80 ms. Just releasing the key takes about 106 ms. Fire as soon as the speed bar turns green.',
    points: [
      'Counter-strafing gets you accurate about 25 ms sooner than releasing. Tap the opposite key, don\'t hold it, or you start moving the other way.',
      'Fire the moment the speed meter turns green. Firing earlier misses, firing later wastes the peek.',
      'The drill tracks every stop: how long it took, and whether you counter-strafed or just released.',
    ],
  },
  {
    title: 'Shooting while strafing (ADAD)',
    drill: 'strafe-shoot',
    body: 'When you reverse from A to D or D to A, your velocity briefly crosses the rifle accuracy threshold. Watch the speed bar and fire during that window. Releasing the movement key for a beat gives you more time to aim.',
    points: [
      'Pick a rhythm first, then add the shot at the reversal.',
      'A, release, click, D is easier than pure ADAD and almost as hard to hit.',
      'Keep the crosshair still at head height. Your legs do the moving, not your mouse.',
    ],
  },
  {
    title: 'Air strafing',
    drill: 'air-course',
    body: 'A running jump carries your take-off momentum, and the jump reaches about 1.15 m. In the air you steer with a strafe key and the mouse together: hold D and sweep the mouse right to curve right. Holding W while you turn barely bends your path, and keys alone only nudge it (W+D drifts about 0.3 m on a full-speed jump). Strafing into a turn can even add a little speed. Pressing against your motion (S on a forward jump, or A while flying right) quickly bleeds your speed down to a crawl, which is how a jump peek stops short of the open. Landing slows you for about half a second. The jump, air and landing values follow AimPro\'s model and are not Riot numbers.',
    points: [
      'Curve right: release W, hold D, sweep the mouse right smoothly. Curve left with A and the mouse left.',
      'Turning with W held does almost nothing in the air. Use the strafe key on the side you are turning to.',
      'Jump peek: jump out with D, then press A mid-air to stop and drop back toward cover.',
      'You are always inaccurate in the air (+10° rifle spread) and for 0.225 s after landing (+7°), and you move slower for about 0.5 s after a big landing.',
    ],
  },
  {
    title: 'Sniping strafing targets',
    drill: 'sniper',
    body: 'A bolt-action sniper only hits where it\'s aimed if you are scoped and stopped. Against a strafer, aim at the edge of their strafe and fire as they reverse. Against someone crossing a doorway, pre-aim the gap and fire as their body enters. Don\'t chase them.',
    points: [
      'Scoped sensitivity follows Valorant\'s Scoped Sensitivity Multiplier. Set it in Settings.',
      'Leg shots don\'t kill (127 damage). Aim at chest height or above.',
      'Re-scope after every shot. The bolt takes 1.6s.',
    ],
  },
  {
    title: 'Micro vs macro adjustment',
    drill: 'micro',
    body: 'Micro adjustments are the 1 to 6 degree corrections you make when your crosshair placement is almost right, and they decide most rifle duels. Macro flicks are big re-orientations toward an off-angle threat. They use different muscles (fingers and wrist vs. arm), so train both.',
    points: [
      'Micro: precision first. Misses cost more than slowness here.',
      'Macro: the drill marks every flick as clean, overshoot or undershoot.',
      'Overshooting a lot usually means tension or too high a sens. Undershooting means hesitation.',
    ],
  },
  {
    title: 'Reaction and crosshair placement',
    drill: 'angle-hold',
    body: 'Raw reaction time is only part of a gunfight. Good crosshair placement means your reaction is a click, not a flick. In Angle Hold, enemies swing out and shoot back after their own reaction time, so the drill rewards placement at head height on the wall edge as much as reflexes.',
    points: [
      'Typical human visual reaction is 180 to 250 ms. Your monitor and mouse add to it.',
      'Hold the edge, not the middle of the gap. Swingers show up at the edge first.',
      'Hard mode adds decoys and jiggles so you learn not to fire at bait.',
      'Results show your crosshair placement: how far the crosshair was from the enemy\'s head the moment they came into view. Within 2° counts as pre-aimed. Height bias says whether you hold too low or too high.',
    ],
  },
  {
    title: 'Peeking',
    drill: 'peek-duel',
    body: 'A wide swing exposes you fast at full speed, which makes you hard to hit, but you have to stop before you can shoot back. A jiggle peek gathers information and baits a shot. Peek Duels puts it together: enemies you can\'t see hold angles and fire after their reaction time while you\'re exposed.',
    points: [
      'Exposure time is the number that matters. Clear the angle, stop, shoot, done.',
      'Being exposed while slow is the worst case: easy to hit, and you can\'t shoot back yet.',
      'Clear one side at a time.',
      'Each round banner shows how far your crosshair was from the enemy when they appeared. Pre-aim where a head will be before you swing.',
    ],
  },
  {
    title: 'Pre-aiming a route',
    drill: 'pre-aim',
    body: 'Pre-aiming means your crosshair is already on the spot where the next head will appear before you can see it, so the fight starts with a click instead of a flick. Pre-aim Route walks you through a corridor, a room and a site with a set of common angles: a tight corner, a head over a box, a deep angle and a raised platform. A different set of them is held each run, so you can\'t skip checks.',
    points: [
      'Move the crosshair to the next angle while you are still behind cover, then slice the corner slowly.',
      'Clear angles one at a time, closest first. The tight corner right out of a doorway kills most players.',
      'Watch the placement readout. Under 2° means you were pre-aimed.',
    ],
  },
  {
    title: 'Playing against flashes',
    drill: 'anti-flash',
    body: 'A flash only blinds you if you are looking toward it with line of sight when it pops. In StrafeLab it blinds fully within 60° of your view, partly up to 100°, and not at all beyond that or behind cover. The enemy who threw it usually swings straight after, so the skill is turning away on the throw, then turning back at the pop.',
    points: [
      'React to the throw (sound and orb), not the pop. By the pop it is too late.',
      'Turn back the moment it pops. The swing comes 0.2 to 0.8 s later depending on difficulty.',
      'Hard mode mixes in fake flashes with no swing, and swings with no flash.',
    ],
  },
  {
    title: 'Silent jumps',
    drill: 'silent-jump',
    body: 'A jump can be heard twice: at take-off and on landing. The take-off is silent whenever you hold Walk or Crouch as you press jump, even straight out of a run. With neither, it\'s heard, even from a standstill. A landing is silent when you hold Walk or Crouch and land higher than you jumped from (you fall less than you rose), or when you barely fall at the end of your jump at walking speed. Crouching while you jump pulls your legs up, so you clear a ledge that a normal jump can\'t reach and land close to the top of your jump, a short and silent fall. Releasing crouch mid-air after a crouch-jump also lands silently at walking speed, even on flat ground.',
    points: [
      'Hold Walk, then jump and crouch together, and you get onto the ledge without a sound. A crouch-jump is silent at take-off even without Walk.',
      'Bind Walk and Jump to the same key if pressing both together is awkward.',
      'A silent take-off doesn\'t save a loud landing on flat ground or a drop. Landing back at or below your take-off height is heard. Take small steps down, never the full drop.',
    ],
  },
  {
    title: 'Sound discipline',
    drill: 'move-course',
    body: 'Running footsteps can be heard from far away in Valorant. Walking (Shift) and crouching are silent. The Movement Course makes you walk the purple sound zone (each running step costs +1s), crouch through a vent, climb boxes, clear a gate with stopped shots and take a held room.',
    points: [
      'Hold Shift before you enter the zone. One running step is already heard.',
      'Landing from a jump also makes noise.',
      'In the held room, a quick swing beats a slow walk-out.',
    ],
  },
];

/**
 * [label, value, source]: 'wiki' = VALORANT wiki or Riot patch notes, 'est' = trainer estimate.
 */
export const NUMBERS = [
  ['Sensitivity', '0.07° per mouse count × in-game sens', 'est'],
  ['Field of view', '103° horizontal at 16:9 (vertical FOV fixed on other aspect ratios)', 'est'],
  ['Zoom levels', 'Sniper 2.5x / 5x · rifle ADS 1.25x', 'wiki'],
  ['Zoomed view & sens', 'Horizontal FOV divided by zoom, with separate ADS and scoped sensitivity multipliers', 'est'],
  ['Run speed', '6.75 m/s knife · 5.40 m/s rifle · 5.13 m/s sniper', 'wiki'],
  ['Zoomed move speed', 'Rifle ADS 76% (4.10 m/s) · sniper scoped 72% (3.69 m/s)', 'wiki'],
  ['Accurate below', '27.5% of run speed for rifles (1.49 m/s), 15% for the sniper', 'wiki'],
  ['Rifle spread', '0.25° first shot (0.157° ADS), 1° max spraying; +0.8° crouch-moving, +3° walking, +6° running, +10° airborne', 'wiki'],
  ['Sniper spread', '0° scoped and still, 5° unscoped; +7.5° crouch-moving, +10° walking, +15° running or airborne', 'wiki'],
  ['Landing', '+7° spread on every gun for 0.225 s after you land', 'wiki'],
  ['Tagging', 'Getting hit slows you (and bots) 72.5%, down to the accuracy deadzone (patches 3.0, 9.10); recovers over ~0.5 s (estimate)', 'wiki'],
  ['Rifle damage', 'Head 160 · Body 40 · Legs 34 (150 HP target)', 'wiki'],
  ['Sniper damage', 'Head 255 · Body 150 · Legs 120 · 0.6 shots/s', 'wiki'],
  ['Walk / crouch', '56% / 45% of run speed. Both are silent.', 'est'],
  ['Rifle stop time', 'From full speed to the 27.5% cutoff: ~80 ms counter-strafing (fitted to Range footage showing accurate shots 83 ms after the opposite key), ~106 ms on release. Full stop on release: ~160 ms.', 'est'],
  ['Rifle acceleration', '~0.26 s from standstill to run speed', 'est'],
  ['Enemy bots', 'React in 0.45 / 0.34 / 0.25 s (easy/medium/hard), then rifle taps vs your 150 HP; they hit you less while you move or jump', 'est'],
  ['Air strafing', 'Steer with strafe key + mouse; air speed along your keys is capped at 0.75 m/s (Quake-style), half accel when pushing 150°+ against your path (AimPro model)', 'est'],
  ['Jump', '~1.15 m apex, ~0.675 s in the air (AimPro model)', 'est'],
  ['Crouch-jump', 'Crouching in the air lifts your feet 0.25 m (reach ~1.37 m)', 'est'],
  ['Quiet speed', 'Up to 108% of walking speed (3.27 m/s with a rifle). Faster than this, footsteps start.', 'est'],
  ['Silent jump', 'Walk or Crouch held at take-off, at any speed. Otherwise the jump is heard.', 'est'],
  ['Silent landing', 'Walk or Crouch held and landing higher than take-off (any speed), or a fall of ~0.3 m or less at quiet speed', 'est'],
  ['Landing slow', 'For 0.5 s after a fall over 0.05 m your speed limit dips (to 50% after a full jump) and recovers (AimPro model)', 'est'],
  ['Air drift', 'Full-speed jump holding W+D drifts ~0.3 m sideways (~1/12 of the jump)', 'est'],
  ['Tick rate', 'Physics simulated at 128 Hz', 'wiki'],
];
