# Plan: getting StrafeLab's movement right

StrafeLab's movement numbers are partly measured and partly estimated. This plan replaces the estimates with measurements from Valorant itself. It also keeps outside numbers that aren't cleared for public use out of `main`. [CONTEXT.md](CONTEXT.md) has the history and the current state of each branch.

## Where things stand (27 Nov 2026)

| Source | What it gave us | Can it go into `main`? |
| --- | --- | --- |
| VALORANT wiki and Riot patch notes | Run speeds, accuracy cutoffs, spread, landing penalty, tagging | Yes (already in) |
| User's descriptions of Valorant | Air drift of about 1/12 of the jump with keys only, a 180° turn landing about 0.5 m behind, silent-jump rules | Yes (already in) |
| Radiant movement guide video (frame-by-frame key overlay) | Rifle accurate 83 ms after the opposite key, and the A key pulling a jump peek back | Yes. The 80 ms counter-strafe is on `system-check-placement` |
| AimPro numbers (scraped client, no license) | A full ground, air, jump and landing model | Owner's call. On the local branch `outside-values-test`, AimPro's jump, air steering and landing are the default (the user judged them closer to Valorant), while StrafeLab keeps its ground movement and silent-jump rules |

## Steps

1. **Record the Valorant Range test list** (below). Done by the user, saved as an MP4 in `D:\Projects`.
2. **Measure the recording frame by frame**, the same way as the earlier videos:
   - Time each mechanic from the key press shown on the overlay to the game's response: the Shooting Error graph, the view moving past floor lines, landing.
   - Use the cleanest repeat as the physics limit. Set aside repeats where technique, not physics, explains the result, and say which ones and why. The player's technique may not be optimal, and that must not end up in the physics.
3. **Run both models through the same tests** in the debug page (`player.model = 'strafelab'` or `'aimpro'`) and put three columns side by side: Valorant, StrafeLab and the AimPro profile.
4. **Decide mechanic by mechanic** (jump and air steering are already decided in AimPro's favour by the user's playtest; the recording should confirm or refine them) what to change in StrafeLab's own model: acceleration, stopping, counter-strafe, walk and crouch speeds, jump height and arc, air steering, mid-air reversal, landing slow-down and crouch-jump. Retune using the Valorant measurements. The AimPro numbers are only a comparison and are never copied in.
5. **Update the guide's reference numbers.** Label each value by where it came from: `wiki`, `measured` (from the recording) or `est`.
6. **Merge:**
   - The re-credit is done on `outside-values-test` (`ec0b607`, `f66ab16`). Merge from that history, not from the old `system-check-placement` commits. `origin/system-check-placement` was force-pushed to the re-credited history on 27 Nov 2026.
   - `outside-values-test` stays local until the owner decides whether AimPro-derived jump and air values may go public. If not, retune the same behaviour from the Valorant recording and drop the branch.
   - Every push adds its changes to CONTEXT.md.
7. **Playtest by hand:** the new drills (Pre-aim Route, Anti-flash), the System check with a real mouse, and the retuned movement.

## Valorant Range recording list

**Setup:**
- **Recording:** 60 fps.
- **Key overlay:** it must show W, A, S, D, Space, Ctrl, Shift, the mouse buttons, and the scroll wheel if jump is on it.
- **Range settings:** Show Shooting Error on, infinite ammo, bots off.
- **Agent and weapon:** an agent without movement abilities, with the Vandal unless a test says otherwise.
- **Between reps:** do each test 3 times, and say or type the test number before each one.

**Ground**

1. Hold D for 2 s from standstill, release (then A).
2. Run with D and release everything. Fire when you think you're accurate.
3. Run with D, tap A, fire. Do it with a clean tap and with both keys held briefly.
4. ADAD for 5 s, firing on each reversal.
5. Shift + D for 2 s from standstill (walk speed).
6. Ctrl + D for 2 s from standstill (crouch speed).
7. Test 1 with the knife.
8. Test 1 with the Operator, unscoped and scoped.
9. W down a lane from a distance marker for 3 s.

**Jumping**

10. Standing jump beside a wall or box edge.
11. Full-speed W, jump on a floor line, W held to landing.
12. Test 11 with the knife.
13. Lowest reachable box: a normal jump, then a crouch-jump.
14. Crouch-jump on flat ground, releasing Ctrl at the top.
15. Jump from standstill, then W in the air (then D).

**Air (full-speed W jump on a floor line)**

16. W + D, mouse still.
17. Release W, D only, mouse still.
18. W held, smooth 90° mouse turn right.
19. D only, smooth 90° mouse turn right.
20. No keys, 90° mouse turn.
21. 180° flick with W held.
22. S right after take-off.
23. Full-speed D, jump, press A: once right after take-off and once at the top of the jump.

**Accuracy timing (Shooting Error graph)**

24. Jump in place and fire on landing, then about 0.2 s after and about 0.5 s after.
25. Fire at the top of a jump.
26. Fire while walking (Shift + D), then while crouch-walking (Ctrl + D).
27. 1 shot standing still, then a 5-shot spray.

**Sound (say or type the result, since audio can't be measured from frames)**

28. Plain jump in place.
29. Shift + jump in place, and from a full run.
30. Crouch-jump from a full run.
31. Walk (Shift) off the lowest box, then run off it.

## Open questions

- **Air steering:** the user's playtest favours AimPro's Quake-style steering (strafe key plus mouse). Tests 16 to 20 confirm it and refine the 0.75 m/s cap and the 0.45 air control.
- **Mid-air reversal:** does it carry you behind take-off (StrafeLab, about 0.5 m) or just stop you (AimPro)? Tests 21 to 23 settle it.
- **Jump apex:** now 1.0 m (AimPro's 1.15 m felt too high in playtest). Tests 10 and 13 confirm it, along with the crouch-jump reach (about 1.2 m) and the Silent Jumps ledge heights (1.03 to 1.15 m).
- **Landing slow-down:** now 60% of AimPro's dip (about 75% speed at worst, from playtest). Tests 11 and 24 measure the real dip, separate from the +7° accuracy penalty.
