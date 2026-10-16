# RECKON — screen map (v2, phase 1)

Every screen has one job and at most one primary action, placed in the bottom half of the screen. Checked against the brief's §3 (one accent per app, sentence-case headers, grouped lists, sheets, no blank states).

| Screen | One job | Primary action | Notes |
|---|---|---|---|
| Hub `/` | Open an app | Tap a tile | Tiles carry each app's accent. |
| **KEPT** Home | Know what is safe to spend today | + Add (tab bar) | Hero: safe to spend /day. |
| KEPT Spend | See where the money went | + Add | Month chips, category list. |
| KEPT EMIs | See loans and what they cost | + Add | |
| KEPT Insights | Read one finding at a time | — | Tiles push a sub-page with a back bar. |
| **SPENT** Today | Know how much of today is yours | **Check in** | Usual day assumed and faded until checked in. "Edit day" is the only other link. |
| SPENT check-in (deck) | Confirm the day in ~20 s | Yes / No / Skip (swipe or tap) | ≤ 5 questions; "no" opens a dial (ring + 3 presets); ends on one line. Opens by itself after 19:00 (today) or before noon (an unconfirmed yesterday), once. |
| SPENT Edit day (pushed) | Correct any category by hand | Done (nav bar) | The 12-row list lives only here. Clear has Undo. |
| SPENT Week | See seven days side by side | Tap a day → Edit day | Assumed days faded. |
| SPENT Insights | One true sentence about the hours | — | Says "mostly assumed" when it is. |
| SPENT Usual day | Tell RECKON where to start | — | Grouped rows, target, weekend days. |
| **DECIDED** Open | Look back on what is due | + Log | Grouped rows, no coloured edges. |
| DECIDED Journal / Insights / How | Read | + Log | |
| Account | Settings | — | Grouped list (unchanged structure). |

Tab bars: KEPT 4 + add, SPENT 4, DECIDED 4 + add. Hub tab bar: Home · apps · Account (5 — the hub's, not an app's).
