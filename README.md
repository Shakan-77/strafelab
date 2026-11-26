# StrafeLab: Valorant aim & movement trainer

A browser-based 3D trainer for Valorant sensitivity, movement and aim practice. It has 18 drills, parties for training with friends, and a persistent leaderboard.

## Run it

You need Python 3.8+ and nothing else (the server uses only the standard library).

```bash
python server.py
```

Open http://localhost:8787 in desktop Chrome or Edge for raw mouse input. If an embedded browser blocks mouse capture, open the same address in the desktop browser. Three.js is loaded from a CDN, so the first load needs internet.

Options: `--port 9000`, `--host 127.0.0.1` (local only). By default the server listens on all interfaces so friends on your network can join at the LAN address it prints. To play over the internet, forward the port or put the server behind a tunnel.

## Drills

| Category | Drill | Trains |
|---|---|---|
| Movement | Counter-Strafe Drill | Stopping with the opposite key and tapping the head while the window is open. Every stop is timed. |
| Movement | ADAD Strafe Shooting | Firing at the dead point of each strafe. Lucky moving hits score almost nothing. |
| Movement | Silent Jumps | Hold Walk (or Crouch) and crouch-jump onto ledges a normal jump can't reach. Jumps with neither held are heard, and so are hard or fast landings. |
| Movement | Air Strafe Course | Time trial where some landings are only reachable by curving mid-air (strafe and mouse in sync). |
| Precision | Strafing Bots: Rifle Taps | Humanoid head/body/leg hitboxes that ADAD, stop and crouch with player-like acceleration. |
| Precision | Micro Adjust | 1–6° corrections onto head-sized targets. |
| Precision | Macro Flicks | 30–150° flicks, each classified as clean, overshoot or undershoot. |
| Precision | Grid Taps | Rapid taps and streaks on a five-by-three grid. |
| Precision | Multi-Target Switch | Switching between targets at different depths before they expire. |
| Precision | Strafe Transfers | Two taps on a moving target at head height. Compare first-tap and follow-up times with your last run. |
| Precision | Strafe Tracking | Continuous aim on an original humanoid bot, measured by time on target and on the head. |
| Sniper | Sniper: Strafing Targets | Bolt-action, 2.5x/5x scope, vs ADAD strafers and doorway crossers. |
| Reaction | Reaction Time | 12-trial visual reaction test. Hard adds go/no-go decoys. |
| Reaction | Angle Hold | Hold a gap while enemies swing out and shoot back after their reaction time. |
| Reaction | Anti-flash | Turn away from a flash before it pops, then turn back and win the swing that follows. |
| Simulation | Peek Duels | 10 rounds: peek hidden angle-holders, counter-strafe and kill before they react. |
| Simulation | Pre-aim Route | Clear a corridor, a room and a site where a different set of common angles is held each run. |
| Simulation | Movement Course | Silent walk zone, crouch vent, box climb, shooting gate, held room. |

Each drill has Easy, Medium and Hard, and each difficulty has its own leaderboard.

Peek Duels, Angle Hold, Pre-aim Route, Anti-flash and Movement Course also score your **crosshair placement**: how far the crosshair was from the enemy's head at the moment they came into view, the share of enemies you had pre-aimed (within 2°), and whether you tend to hold too low or too high. It doesn't change the score or leaderboards.

## System check

The **System check** tab runs an 8-second captured mouse test and explains the result in plain language: polling rate, input stalls (your mouse kept reporting but the page stopped getting mouse events, which feels like the aim sticking), single-event movement spikes, rescaled mouse values, frame rate, frame hitches and event delay. Each problem comes with what to try, and **Copy report** puts the numbers on your clipboard. In a drill, **Pause > Input details** shows the same stall, spike and hitch counts since the mouse was captured.

## Rifle skins

Pick a rifle skin in **Settings > Rifle skin**, with a live 3D preview: Standard, **Pulse Core** (carbon weave with pulsing circuit traces), **Verdant Bloom** (stone and glowing vines), **Bastion Gilt** (ivory plating, gold trim, sapphire core) or **Wraithbound** (black steel in a flickering violet haze). Each skin animates on the first-person rifle, tints your tracers and plays its own kill sound. All of them are original: textures are generated in code and sounds are synthesized with WebAudio, so the repo contains no game assets.

## Valorant-matched settings

- **Sensitivity:** With raw mouse input enabled, hipfire turns 0.07° per mouse count × your in-game sensitivity. Match your mouse DPI for the cm/360 readout. Set rifle ADS and sniper scoped multipliers separately in **Settings > Mouse**.
- **FOV:** 103° horizontal at 16:9.
- **Crosshair:** paste your Valorant crosshair profile code (Settings > Crosshair > Import). Colour, outlines, centre dot, and inner and outer lines are supported.
- **Enemy highlight colour:** red, yellow or purple.

Weapon stats use the [VALORANT wiki](https://wiki.playvalorant.com/en-us/Vandal) and [Riot's patch notes](https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-3-0/). StrafeLab estimates the braking curve, acceleration, walk and crouch speeds, jump physics, and zoomed camera projection. The in-app Guide labels these estimates.

## Parties

1. One player clicks **Create party** and shares the 5-letter code (8 players max).
2. The leader picks a drill and difficulty (**Set for party**) and presses **Start run**.
3. Everyone gets the same seeded spawns and a synchronized countdown. Live scores show top-right (hold **Tab** for the full board), movement courses show party ghosts, and the run ends with a ranked results table. Party scores also count for the global leaderboard.

## Controls

Defaults: `WASD` move · `Shift` walk · `Left Ctrl`/`C` crouch · `Space` jump · `LMB` fire · `RMB` scope · `R` reload · `Tab` party board · `Esc` pause.

Rebind everything in **Settings > Controls**. Each action has a primary and a secondary slot, and you can use any key, any mouse button (including the side buttons) or the wheel (for Jump, Fire, Scope and Reload). Walk and crouch can be hold or toggle, and scope can be toggle or hold. Esc is reserved for pausing.

Every run also carries the knife. Press **3** (Knife) to draw it and run at 6.75 m/s, and **1** (Primary weapon) to switch back. Your speed changes the moment you swap. You can fire again once the gun is drawn: 1.0 s for the rifle, 1.5 s for the sniper. Each weapon keeps its own ammo. A run finished with the knife out still counts as a run with the drill's weapon.

While a run is on screen, browser shortcuts are blocked: Ctrl+H, Ctrl+F, Ctrl+D, Ctrl+P, Ctrl+J, F5, the Alt menu, right-click menu, page zoom, and mouse back/forward. Chrome only lets a page capture Ctrl+W, Ctrl+T and Ctrl+N in fullscreen, so runs start in fullscreen with keyboard lock by default ("Play in fullscreen" in Controls). Hold Esc to leave fullscreen. If fullscreen is off, those shortcuts show a "Leave site?" prompt instead of closing the run.

## Project layout

```
server.py                  HTTP + WebSocket server, parties, leaderboard (data/leaderboard.json)
public/index.html          UI shell
public/data/scenarios.json drill metadata, shared by client and server
public/js/main.js          menus, party lobby, leaderboards, settings, results
public/js/syscheck.js      System check tab
public/js/inputprobe.js    input and frame measurements shared by the System check and drills
public/js/game/            engine: game loop, player physics, weapons, bots, HUD, ghosts
public/js/scenarios/       the drills
```

Add `?debug=1` to the URL to run without pointer lock and expose `window.__sl` for testing.
