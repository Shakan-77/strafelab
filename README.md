# StrafeLab: Valorant aim & movement trainer

A browser-based 3D trainer tuned to Valorant's mechanics: Valorant sensitivity and FOV, run/walk speeds, movement inaccuracy, counter-strafing, crouch-jumps with silent landings, and one-tap rifle damage. It has 12 drills, parties for training with friends, and a persistent leaderboard.

## Run it

You need Python 3.8+ and nothing else (the server uses only the standard library).

```bash
python server.py
```

Open http://localhost:8787 in Chrome or Edge. Raw mouse input needs a Chromium browser. Three.js is loaded from a CDN, so the first load needs internet.

Options: `--port 9000`, `--host 127.0.0.1` (local only). By default the server listens on all interfaces so friends on your network can join at the LAN address it prints. To play over the internet, forward the port or put the server behind a tunnel.

## Drills

| Category | Drill | Trains |
|---|---|---|
| Movement | Counter-Strafe Drill | Stopping with the opposite key and tapping the head while the window is open. Every stop is timed. |
| Movement | ADAD Strafe Shooting | Firing at the dead point of each strafe. Lucky moving hits score almost nothing. |
| Movement | Silent Jumps | Hold Walk and crouch-jump onto ledges a normal jump can't reach. Jumps without Walk are heard, and so are hard or fast landings. |
| Movement | Air Strafe Course | Time trial where some landings are only reachable by curving mid-air (strafe and mouse in sync). |
| Precision | Strafing Bots: Rifle Taps | Humanoid head/body/leg hitboxes that ADAD, stop and crouch with player-like acceleration. |
| Precision | Micro Adjust | 1–6° corrections onto head-sized targets. |
| Precision | Macro Flicks | 30–150° flicks, each classified as clean, overshoot or undershoot. |
| Sniper | Sniper: Strafing Targets | Bolt-action, 2.5x/5x scope, vs ADAD strafers and doorway crossers. |
| Reaction | Reaction Time | 12-trial visual reaction test. Hard adds go/no-go decoys. |
| Reaction | Angle Hold | Hold a gap while enemies swing out and shoot back after their reaction time. |
| Simulation | Peek Duels | 10 rounds: peek hidden angle-holders, counter-strafe and kill before they react. |
| Simulation | Movement Course | Silent walk zone, crouch vent, box climb, shooting gate, held room. |

Each drill has Easy, Medium and Hard, and each difficulty has its own leaderboard.

## Valorant-matched settings

- **Sensitivity:** 0.07° per mouse count × your Valorant sens, so the cm/360 is the same as in-game. The scoped sensitivity multiplier works the same way.
- **FOV:** 103° horizontal at 16:9.
- **Crosshair:** paste your Valorant crosshair profile code (Settings > Crosshair > Import). Colour, outlines, centre dot, and inner and outer lines are supported.
- **Enemy highlight colour:** red, yellow or purple.

Weapon behaviour (spread, accuracy thresholds, ADS/scope zoom and move speed, landing inaccuracy, tagging, damage, fire rates) follows the official VALORANT wiki and patch notes. Values Riot doesn't publish (walk and crouch speed, acceleration, jump height, crouch-jump lift, sound thresholds, tagging duration) are estimates. The in-app Guide marks every number as "Official wiki" or "Estimate".

## Parties

1. One player clicks **Create party** and shares the 5-letter code (8 players max).
2. The leader picks a drill and difficulty (**Set for party**) and presses **Start run**.
3. Everyone gets the same seeded spawns and a synchronized countdown. Live scores show top-right (hold **Tab** for the full board), movement courses show party ghosts, and the run ends with a ranked results table. Party scores also count for the global leaderboard.

## Controls

Defaults: `WASD` move · `Shift` walk · `Left Ctrl`/`C` crouch · `Space` jump · `LMB` fire · `RMB` scope · `R` reload · `Tab` party board · `Esc` pause.

Rebind everything in **Settings > Controls**. Each action has a primary and a secondary slot, and you can use any key, any mouse button (including the side buttons) or the wheel (for Jump, Fire, Scope and Reload). Walk and crouch can be hold or toggle, and scope can be toggle or hold. Esc is reserved for pausing.

While a run is on screen, browser shortcuts are blocked: Ctrl+H, Ctrl+F, Ctrl+D, Ctrl+P, Ctrl+J, F5, the Alt menu, right-click menu, page zoom, and mouse back/forward. Chrome only lets a page capture Ctrl+W, Ctrl+T and Ctrl+N in fullscreen, so runs start in fullscreen with keyboard lock by default ("Play in fullscreen" in Controls). Hold Esc to leave fullscreen. If fullscreen is off, those shortcuts show a "Leave site?" prompt instead of closing the run.

## Project layout

```
server.py                  HTTP + WebSocket server, parties, leaderboard (data/leaderboard.json)
public/index.html          UI shell
public/data/scenarios.json drill metadata, shared by client and server
public/js/main.js          menus, party lobby, leaderboards, settings, results
public/js/game/            engine: game loop, player physics, weapons, bots, HUD, ghosts
public/js/scenarios/       the drills
```

Add `?debug=1` to the URL to run without pointer lock and expose `window.__sl` for testing.
