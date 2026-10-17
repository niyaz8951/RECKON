/* RECKON — the weekly letter: the facts, and a letter written without AI.
   =============================================================================
   week(today)        the last full week, Sunday to Saturday (the working
                      week here; the weekend is Friday and Saturday)
   facts(data, wk)    sums only — no entries, no payees, no notes — from what
                      the three apps already have: KEPT rows, SPENT days,
                      DECIDED decisions. Every figure is a finished string
                      ("AED 1,240", "9h 30m") so a model can copy it and
                      never has to compute one. A section with nothing in
                      it is left out.
   plain(facts)       the same letter in code: what shows when AI is off,
                      or did not answer. It passes the same grounding check
                      (every number in it is in the facts).
   Pure. */
(function (root) {
  'use strict';

  function parse(s) { return new Date(String(s).slice(0, 10) + 'T00:00:00'); }
  function iso(d) { var y = d.getFullYear(), m = d.getMonth() + 1, dd = d.getDate(); return y + '-' + (m < 10 ? '0' : '') + m + '-' + (dd < 10 ? '0' : '') + dd; }
  function add(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return iso(d); }
  function hm(min) { min = Math.round(Number(min) || 0); var h = Math.floor(min / 60), m = min % 60; return h ? h + 'h' + (m ? ' ' + (m < 10 ? '0' : '') + m + 'm' : '') : m + 'm'; }
  function money(minor, cur) {
    var n = Math.round(Math.abs(Number(minor) || 0) / 100);
    return (cur ? cur + ' ' : '') + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function dayName(s) { return parse(s).toLocaleDateString('en-GB', { weekday: 'long' }); }
  function dateLabel(s) { return parse(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).replace('Sept', 'Sep'); }

  function week(today) {
    var d = parse(today), back = (d.getDay() + 1) % 7 || 7;    // days since the last Saturday, never 0
    var to = add(today, -back), from = add(to, -6);
    return { from: from, to: to, key: from, label: dateLabel(from) + ' – ' + dateLabel(to) };
  }
  function inWeek(d, wk) { d = String(d).slice(0, 10); return d >= wk.from && d <= wk.to; }

  function keptFacts(k, wk) {
    if (!k || !k.rows || !k.rows.length) return null;
    var cur = (k.profile && k.profile.currency) || 'AED';
    var isSpend = function (r) { return !r.deleted_at && Number(r.amount_minor) < 0 && (r.kind ? r.kind === 'expense' : !/transfer|invest|loan/i.test(r.cat || '')); };
    var spent = 0, prev = 0, byCat = {}, days = {};
    var pf = add(wk.from, -7), pt = add(wk.to, -7);
    k.rows.forEach(function (r) {
      var d = String(r.d).slice(0, 10);
      if (inWeek(d, wk)) { days[d] = 1; if (isSpend(r)) { spent += -r.amount_minor; byCat[r.cat] = (byCat[r.cat] || 0) - r.amount_minor; } }
      else if (d >= pf && d <= pt && isSpend(r)) prev += -r.amount_minor;
    });
    if (!Object.keys(days).length && !prev) return null;
    var top = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; })[0];
    var f = { spent: money(spent, cur), spent_week_before: money(prev, cur), days_with_entries: Object.keys(days).length };
    if (prev > 0) { var diff = spent - prev; f.change = (diff <= 0 ? money(-diff, cur) + ' less' : money(diff, cur) + ' more') + ' than the week before'; }
    if (top) { f.biggest_category = top; f.biggest_category_amount = money(byCat[top], cur); }
    return f;
  }

  function spentFacts(s, wk) {
    var SE = root.SpentEngine;
    if (!s || !s.days || !SE) return null;
    var prof = SE.profileOf(s.profile || {}), yours = 0, n = 0, best = null, checked = 0;
    s.days.forEach(function (d) {
      if (!inWeek(d.d, wk)) return;
      var mine = SE.byClass(d.blocks || {}, prof).mine;
      n++; yours += mine; if (d.confirmed_at || !d.src) checked++;
      if (!best || mine > best.m) best = { d: d.d, m: mine };
    });
    if (!n) return null;
    var f = { yours_total: hm(yours), yours_per_day: hm(Math.round(yours / n / 5) * 5), days_on_record: n, days_checked_in: checked, target: (prof.target_bp / 100) + '%' };
    if (best && best.m > 0) { f.best_day = dayName(best.d); f.best_day_yours = hm(best.m); }
    return f;
  }

  function decidedFacts(dl, wk, today) {
    var DE = root.DecidedEngine;
    if (!dl || !DE) return null;
    var list = (dl.list || dl).filter(function (d) { return !d.deleted_at; });
    if (!list.length) return null;
    var M = DE.build(list, today);
    var f = { logged_this_week: list.filter(function (d) { return inWeek(d.decided_on, wk); }).length,
      reviewed_this_week: list.filter(function (d) { return d.reviewed_at && inWeek(d.reviewed_at, wk); }).length,
      due_now: M.due.length, open: M.open.length };
    if (M.n >= 3) { f.said_sure = Math.round(M.meanConf) + '%'; f.were_right = Math.round(M.hitRate) + '%'; }
    if (M.upcoming[0]) { f.next_review = M.upcoming[0].title; f.next_review_on = dateLabel(M.upcoming[0].review_on); }
    return f;
  }

  function facts(data, wk, today) {
    var out = { week: { from: dateLabel(wk.from), to: dateLabel(wk.to), days: 7 } };
    var k = keptFacts(data.kept, wk), s = spentFacts(data.spent, wk), d = decidedFacts(data.decided, wk, today || add(wk.to, 1));
    if (k) out.money = k; if (s) out.time = s; if (d) out.decisions = d;
    return out;
  }

  /* The letter without a model. Plain sentences, the facts' own strings. */
  function plain(F) {
    var p = [];
    if (F.money) {
      var m = F.money, s = 'Money: ' + m.spent + ' went on spending this week';
      s += m.change ? ', ' + m.change + '.' : '.';
      if (m.biggest_category) s += ' The biggest share was ' + m.biggest_category + ', at ' + m.biggest_category_amount + '.';
      s += ' You logged something on ' + m.days_with_entries + ' of the ' + F.week.days + ' days.';
      p.push(s);
    }
    if (F.time) {
      var t = F.time, s2 = 'Time: ' + t.yours_total + ' of the week was yours by choice, about ' + t.yours_per_day + ' a day';
      s2 += t.best_day ? ', most on ' + t.best_day + ' (' + t.best_day_yours + ').' : '.';
      s2 += ' ' + t.days_checked_in + ' of ' + t.days_on_record + ' days were checked in; the rest are your usual day standing in.';
      p.push(s2);
    }
    if (F.decisions) {
      var d = F.decisions, s3 = 'Decisions: ' + d.logged_this_week + ' logged and ' + d.reviewed_this_week + ' looked back on this week.';
      if (d.due_now) s3 += ' ' + d.due_now + ' ' + (d.due_now === 1 ? 'is' : 'are') + ' due for review now.';
      else if (d.next_review) s3 += ' Next to look back on: ' + d.next_review + ', on ' + d.next_review_on + '.';
      if (d.said_sure) s3 += ' When you say ' + d.said_sure + ' sure, you are right ' + d.were_right + ' of the time.';
      p.push(s3);
    }
    if (!p.length) p.push('Nothing was on the record for ' + F.week.from + ' – ' + F.week.to + '. A week is easier to read when there is something in it — a check-in, an entry, a decision.');
    var sug = F.decisions && F.decisions.due_now ? 'Look back on the decisions that are due — a minute each.'
      : F.time && F.time.days_checked_in < F.time.days_on_record ? 'Check in each evening this week — a usual day is one swipe.'
      : F.money && F.money.days_with_entries < F.week.days ? 'Log spending on the days you skip — those are where money goes quietly.'
      : 'Keep the same rhythm next week.';
    return { letter: p.join('\n\n'), suggestion: sug };
  }

  root.TNLetter = { week: week, facts: facts, plain: plain, hm: hm, money: money };
})(typeof window !== 'undefined' ? window : globalThis);
