/** Guide content: what each mechanic is, why it matters in Valorant, and which drill trains it. */
export const GUIDE = [
  {
    title: 'Counter-strafing',
    drill: 'counter-strafe',
    body: 'Valorant rifles have a movement accuracy cutoff at 27.5% of run speed. In StrafeLab, releasing the key from full rifle speed crosses that threshold in about 106 ms. Pressing the opposite key takes about 100 ms. Fire as soon as the speed bar turns green.',
    points: [
      'Releasing and counter-strafing are almost equally fast in Valorant. Pick one and time it consistently.',
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
    body: 'In the air, pressing A or D on its own barely changes your path. Holding the strafe key in the same direction you sweep your mouse makes your velocity follow your view, so you can curve around corners and onto ledges. Unlike CS, turning never costs speed, and like Valorant you can\'t gain any: air speed is capped at your take-off speed, so bunny-hopping travels exactly as far as running. Pressing against your motion mid-air only slows you a little.',
    points: [
      'Curve right: release W, hold D, sweep the mouse right smoothly.',
      'Your path can only bend so fast (about 280°/s), so start turning early rather than flicking.',
      'You are always inaccurate in the air (+10° rifle spread) and for 0.225 s after landing (+7°).',
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
    ],
  },
  {
    title: 'Silent jumps',
    drill: 'silent-jump',
    body: 'A jump can be heard twice: at take-off and on landing. The take-off is silent whenever you hold Walk or Crouch as you press jump, even straight out of a run. With neither, it\'s heard, even from a standstill. A landing is silent when you barely fall at the end of your jump and you\'re still at walking speed. Crouching while you jump pulls your legs up, so you clear a ledge that a normal jump can\'t reach and land close to the top of your jump, a short and silent fall. You can stand back up before touching down and the landing stays silent, because the sound depends on how hard you hit the ground, not on your stance.',
    points: [
      'Hold Walk, then jump and crouch together, and you get onto the ledge without a sound. A crouch-jump is silent at take-off even without Walk.',
      'Bind Walk and Jump to the same key if pressing both together is awkward.',
      'A silent take-off doesn\'t save a loud landing: running speed or a long drop makes any landing loud. Take small steps down, never the full drop.',
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
  ['Tagging', 'Getting hit slows you 72.5% (wiki); recovers over ~0.5 s (estimate)', 'wiki'],
  ['Rifle damage', 'Head 160 · Body 40 · Legs 34 (150 HP target)', 'wiki'],
  ['Sniper damage', 'Head 255 · Body 150 · Legs 120 · 0.6 shots/s', 'wiki'],
  ['Walk / crouch', '56% / 45% of run speed. Both are silent.', 'est'],
  ['Rifle stop time', 'From full speed to the 27.5% cutoff: ~106 ms on release, ~100 ms on reversal. Full stop on release: ~160 ms.', 'est'],
  ['Rifle acceleration', '~0.26 s from standstill to run speed', 'est'],
  ['Enemy bots', 'React in 0.50 / 0.38 / 0.28 s (easy/medium/hard), then rifle taps vs your 150 HP; they hit you less while you move or jump', 'est'],
  ['Air strafing', 'Run before take-off to carry momentum. Slow jumps can build up to 1.8 m/s with directional input.', 'est'],
  ['Jump', '~0.93 m apex, ~0.67 s in the air', 'est'],
  ['Crouch-jump', 'Crouching in the air lifts your feet 0.25 m (reach ~1.16 m)', 'est'],
  ['Quiet speed', 'Up to 108% of walking speed (3.27 m/s with a rifle). Faster than this, footsteps start.', 'est'],
  ['Silent jump', 'Walk or Crouch held at take-off, at any speed. Otherwise the jump is heard.', 'est'],
  ['Silent landing', 'Fall of ~0.3 m or less (impact under 3.2 m/s) at quiet speed or slower', 'est'],
  ['Tick rate', 'Physics simulated at 128 Hz', 'wiki'],
];
