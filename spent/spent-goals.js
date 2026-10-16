/* SPENT — countdowns: a goal with a date, and the pace it needs.
   =============================================================================
   One kind of countdown only. A goal has a due date; it may also have an
   hours target and a SPENT category its time is counted from.

     with a category   minutes in that category that someone stood behind
                       (confirmed, focus, ai — never assumed) between the
                       goal's start and today
     without one       the minutes of Focus sessions started on the goal

   From that: days left, the pace needed per day, the pace of the last seven
   days, a projected finish date and one plain verdict. Pure: goals, days and
   sessions in, numbers and sentences out. Needs SpentEngine.

     status(goal, days, sessions, today) -> { state, daysLeft, … }
     say(status)                          -> { head, sub }   the words on screen
     hero(goals, …)                       -> the goal that takes the Today hero
     behind(goals, …)                     -> goals to ask about in the check-in */
(function (root) {
  'use strict';
  var E = root.SpentEngine;

  function diff(a, b) { return Math.round((E.parse(b) - E.parse(a)) / 864e5); }   // b − a in days
  function open(g) { return g && !g.deleted_at && !g.done_at; }

  /* Minutes a goal has collected on one day. */
  function minutesOn(goal, day, sessions, d) {
    if (goal.cat) {
      if (!day || !day.blocks) return 0;
      return E.srcOf(day, goal.cat) === 'assumed' ? 0 : (Number(day.blocks[goal.cat]) || 0);
    }
    return (sessions || []).reduce(function (s, x) { return s + (x.goal_id === goal.id && x.d === d && x.ended_at ? (Number(x.minutes) || 0) : 0); }, 0);
  }

  function status(goal, days, sessions, today) {
    var byD = {}; (days || []).forEach(function (x) { byD[x.d] = x; });
    var start = goal.start_on || today;
    var total = 0, last7 = 0;
    for (var d = start; d <= today; d = E.addDays(d, 1)) {
      var m = minutesOn(goal, byD[d], sessions, d);
      total += m;
      if (diff(d, today) < 7) last7 += m;
    }
    var daysLeft = diff(today, goal.due_on);                 // 0 = due today
    var target = Number(goal.target_min) || 0;
    var remaining = Math.max(0, target - total);
    var span = Math.min(7, diff(start, today) + 1);           // a goal two days old averages over two days
    var actual = span > 0 ? last7 / span : 0;
    var need = target && daysLeft >= 0 ? remaining / (daysLeft + 1) : 0;
    var projected = target && remaining > 0 && actual > 0 ? E.addDays(today, Math.ceil(remaining / actual) - 1) : null;
    var state;
    if (goal.done_at || (target && remaining === 0)) state = 'done';
    else if (daysLeft < 0) state = 'overdue';
    else if (!target) state = 'date';
    else if (diff(start, today) < 3 && total === 0) state = 'new';
    else state = actual >= need * 0.95 || (projected && projected <= goal.due_on) ? 'on-track' : 'behind';
    return { id: goal.id, title: goal.title, cat: goal.cat || null, due: goal.due_on, daysLeft: daysLeft, target: target, total: total,
      remaining: remaining, need: need, actual: actual, projected: projected, state: state, pct: target ? Math.min(1, total / target) : null };
  }

  function daysWord(n) { return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n + ' days left'; }
  function shortDate(d) { return E.parse(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }

  /* The words for one countdown: a headline and one line under it. Never a
     number without what it means. */
  function say(st) {
    var hm = E.hm;
    if (st.state === 'done') return { head: 'Done', sub: st.target ? hm(st.total) + ' put in — the target is met.' : 'Marked done.' };
    if (st.state === 'overdue') return { head: Math.abs(st.daysLeft) + ' day' + (Math.abs(st.daysLeft) === 1 ? '' : 's') + ' past', sub: 'Due ' + shortDate(st.due) + (st.target ? ' · ' + hm(st.remaining) + ' still to go' : '') + '. Move the date or mark it done.' };
    var head = st.daysLeft === 0 ? 'Due today' : st.daysLeft === 1 ? 'Due tomorrow' : st.daysLeft + ' days left';
    if (st.state === 'date') return { head: head, sub: 'Due ' + shortDate(st.due) + '.' };
    if (st.state === 'new') return { head: head, sub: hm(Math.ceil(st.need / 5) * 5) + ' a day gets ' + hm(st.target) + ' done by ' + shortDate(st.due) + '.' };
    var pace = hm(Math.ceil(st.need / 5) * 5) + ' a day needed · ' + hm(Math.round(st.actual / 5) * 5) + ' a day lately';
    if (st.state === 'on-track') return { head: head, sub: pace + '. On track' + (st.projected ? ' to finish ' + shortDate(st.projected) : '') + '.' };
    return { head: head, sub: pace + '. Behind' + (st.projected ? ' — at this pace it lands ' + shortDate(st.projected) : ' — nothing put in this week') + '.' };
  }

  /* The goal on the Today hero: the pinned one, if it is still open. */
  function hero(goals, days, sessions, today) {
    var g = (goals || []).filter(function (x) { return open(x) && x.pinned; })[0];
    return g ? { goal: g, status: status(g, days, sessions, today) } : null;
  }
  /* Open goals in date order, each with its status. */
  function list(goals, days, sessions, today) {
    return (goals || []).filter(function (g) { return !g.deleted_at; })
      .map(function (g) { return { goal: g, status: status(g, days, sessions, today) }; })
      .sort(function (a, b) {
        var da = a.status.state === 'done' ? 1 : 0, db = b.status.state === 'done' ? 1 : 0;
        return da - db || (a.goal.due_on < b.goal.due_on ? -1 : a.goal.due_on > b.goal.due_on ? 1 : 0);
      });
  }
  /* Behind, with a category the check-in can ask about — nearest first. */
  function behind(goals, days, sessions, today) {
    return list(goals, days, sessions, today).filter(function (x) { return open(x.goal) && x.goal.cat && x.status.state === 'behind'; });
  }

  var api = { status: status, say: say, hero: hero, list: list, behind: behind, minutesOn: minutesOn, diff: diff, daysWord: daysWord };
  root.SpentGoals = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
