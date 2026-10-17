# RECKON — screen map (v2, phases 1–3 + AI)

Every screen has one job and at most one primary action, placed in the bottom half of the screen. Checked against the brief's §3 (one accent per app, sentence-case headers, grouped lists, sheets, no blank states).

| Screen | One job | Primary action | Notes |
|---|---|---|---|
| Hub `/` | Open an app | Tap a tile | Tiles carry each app's accent. One row under them: Your week. |
| Your week `/letter/` | Read last Sunday–Saturday | — | Plain letter written in code; with AI on, worded by AI and checked. The numbers it came from sit under it. Cached for offline. |
| **KEPT** Home | Know what is safe to spend today | + Add (tab bar) | Hero: safe to spend /day (allows for set-asides). At most one card under it: heads-up, look back, or bring your year in — each says why. |
| KEPT Spend | See where the money went | + Add | Month chips, category list. |
| KEPT EMIs | See loans and what they cost | + Add | |
| KEPT Insights | Read one finding at a time | — | Tiles push a sub-page with a back bar. |
| **SPENT** Today | Know how much of today is yours | **Check in** | Usual day assumed and faded until checked in. "Edit day" is the only other link. |
| SPENT Focus (full screen) | Count one stretch of time | Stop | Pick a category first.  Screen kept awake; survives reload; Discard adds nothing. Minutes go into the day as "focus". |
| SPENT check-in (deck) | Confirm the day in ~20 s | Yes / No / Skip (swipe or tap) | ≤ 5 questions; "no" opens a dial (ring + 3 presets); ends on one line. Opens by itself after 19:00 (today) or before noon (an unconfirmed yesterday), once. |
| SPENT Edit day (pushed) | Correct any category by hand | Done (nav bar) | The 12-row list lives only here. Clear has Undo. |
| SPENT Week | See seven days side by side | Tap a day → Edit day | Assumed days faded. |
| SPENT Insights | One true sentence about the hours | — | Says "mostly assumed" when it is. |
| SPENT Usual day | Tell RECKON where to start | — | Grouped rows, target, weekend days. |
| **DECIDED** Open | Look back on what is due | Look back now (when due) / + Log | Hero = nearest look-back as a countdown (days, ring = wait gone); each open row shows days to go and a track. |
| DECIDED review (deck) | Review a due decision in ~1 min | Yes / No / Skip, then dial, then two one-line cards | ≤ 3 a sitting. With AI on, the lesson card offers Suggest one (fills the box; nothing saved without Save). |
| DECIDED Journal / Insights / How | Read | + Log | |
| Account | Settings | — | Grouped list; AI switch with a plain note of what is sent. |

Tab bars: KEPT 4 + add, SPENT 4, DECIDED 4 + add. Hub tab bar: Home · apps · Account (5 — the hub's, not an app's).
