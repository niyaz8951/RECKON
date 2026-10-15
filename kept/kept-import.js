/* KEPT — Excel / CSV import and export (SheetJS, vendored).
   =============================================================================
   The column mapper and the row parser are pure (they take an array of
   arrays) so the tests can run them without SheetJS; only readFile(),
   download() and sample() touch XLSX. Amounts come out as INTEGER minor
   units, dates as 'YYYY-MM-DD'. Negative = spending, as in the sheet.

   SheetJS is 880 KB and is needed only here, so it is fetched the first
   time one of those three functions runs rather than on every page open. */
(function (root) {
  'use strict';

  var XLSX_SRC = '/assets/vendor/xlsx.full.min.js?v=1';
  function ensureXLSX() {
    if (root.XLSX) return Promise.resolve(root.XLSX);
    if (!root.TN || !root.TN.loadScript) return Promise.reject(new Error('The spreadsheet library did not load.'));
    return root.TN.loadScript(XLSX_SRC).then(function () {
      if (!root.XLSX) throw new Error('The spreadsheet library did not load.');
      return root.XLSX;
    });
  }

  /* Fuzzy header mapping for arbitrary bank exports. Exact match first,
     then "header contains alias". */
  var COLMAP = {
    date:   ['date', 'txn date', 'transaction date', 'posting date', 'value date'],
    desc:   ['expense', 'description', 'merchant', 'narration', 'details', 'particulars', 'payee', 'item'],
    amount: ['amount', 'spend', 'debit', 'withdrawal', 'expense amount', 'value', 'amt', 'transaction amount'],
    credit: ['credit', 'deposit', 'income amount'],
    cat:    ['category', 'cat', 'type of expense', 'head'],
    type:   ['type', 'dr/cr', 'transaction type', 'flow'],
    rem:    ['remarks', 'remark', 'note', 'notes', 'tag', 'comment']
  };
  function mapCols(headers) {
    var H = (headers || []).map(function (h) { return String(h == null ? '' : h).trim().toLowerCase(); });
    var found = {};
    Object.keys(COLMAP).forEach(function (key) {
      var idx = -1, aliases = COLMAP[key], i;
      for (i = 0; i < aliases.length && idx < 0; i++) idx = H.indexOf(aliases[i]);
      for (i = 0; i < aliases.length && idx < 0; i++) {
        for (var j = 0; j < H.length; j++) if (H[j] && H[j].indexOf(aliases[i]) > -1) { idx = j; break; }
      }
      found[key] = idx;
    });
    return found;
  }

  /* Excel serial numbers, Date objects and date strings → 'YYYY-MM-DD'. */
  function toISO(v) {
    var d = null;
    if (v instanceof Date) d = v;
    else if (typeof v === 'number') d = new Date(Math.round((v - 25569) * 864e5));
    else if (typeof v === 'string') {
      var s = v.trim();
      var m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);   // dd/mm/yyyy — the Gulf and India write day first
      if (m) { var y = m[3].length === 2 ? '20' + m[3] : m[3]; return y + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0'); }
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
      d = new Date(s); if (isNaN(d)) d = null;
    }
    if (!d) return null;
    // Serial dates are UTC midnight; strings parsed by Date() may be local.
    var useUTC = typeof v === 'number' || (typeof v === 'string' && /T|Z/.test(v));
    return useUTC
      ? d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0')
      : d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function toMinor(v) {
    if (typeof v === 'string') v = parseFloat(v.replace(/[, ]/g, '').replace(/[^\d.\-()]/g, '').replace(/^\((.*)\)$/, '-$1'));
    if (v == null || isNaN(v)) return null;
    return Math.round(v * 100);
  }

  /* aoa: array of arrays, as sheet_to_json(header:1) gives. Finds the header
     row within the first five, maps the columns, returns the rows plus the
     mapping so the page can show "Date ← Txn Date, Amount ← Debit". */
  function rowsFromAOA(aoa) {
    if (!aoa || aoa.length < 2) throw new Error('No usable rows found in the file.');
    var hi = -1, cols = null;
    for (var i = 0; i < Math.min(5, aoa.length); i++) {
      var c = mapCols(aoa[i] || []);
      if (c.amount > -1 && c.desc > -1) { hi = i; cols = c; break; }
    }
    if (!cols) throw new Error('Could not find Date / Description / Amount columns. Check the header row.');
    var out = [], skipped = 0;
    for (var r = hi + 1; r < aoa.length; r++) {
      var row = aoa[r]; if (!row) continue;
      var amt = toMinor(row[cols.amount]);
      if (cols.credit > -1) {
        var cr = toMinor(row[cols.credit]);
        if (amt == null || amt === 0) amt = cr != null ? Math.abs(cr) : null;
        else { amt = -Math.abs(amt); if (cr != null && cr !== 0) amt = Math.abs(cr); }
      }
      if (amt == null || amt === 0) { skipped++; continue; }
      var desc = row[cols.desc] != null ? String(row[cols.desc]).trim() : '';
      if (!desc) { skipped++; continue; }
      var d = cols.date > -1 ? toISO(row[cols.date]) : null;
      if (!d) { skipped++; continue; }
      var cat = cols.cat > -1 && row[cols.cat] ? String(row[cols.cat]).trim() : 'Misc';
      var typ = cols.type > -1 && row[cols.type] ? String(row[cols.type]).trim().toLowerCase() : '';
      if (typ) {
        if (/^(dr|debit|expense|out|withdrawal)/.test(typ)) amt = -Math.abs(amt);
        else if (/^(cr|credit|income|in|deposit)/.test(typ)) amt = Math.abs(amt);
      }
      var rem = cols.rem > -1 && row[cols.rem] ? String(row[cols.rem]).trim() : '';
      out.push({ d: d, descr: desc, amount_minor: amt, cat: cat, remark: rem });
    }
    if (!out.length) throw new Error('Parsed 0 transactions — the amount column may be empty.');
    var headers = aoa[hi];
    var mapping = {};
    Object.keys(cols).forEach(function (k) { if (cols[k] > -1) mapping[k] = String(headers[cols[k]]); });
    return { rows: out, skipped: skipped, mapping: mapping, headerRow: hi };
  }

  /* Picks the sheet with the most rows. */
  function parseWorkbook(wb) {
    var best = null, bestLen = 0;
    wb.SheetNames.forEach(function (sn) {
      var js = root.XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true });
      if (js.length > bestLen) { best = js; bestLen = js.length; }
    });
    return rowsFromAOA(best);
  }
  function readFile(file) {
    return ensureXLSX().then(function () { return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onerror = function () { reject(new Error('Could not read the file.')); };
      fr.onload = function () {
        try { resolve(parseWorkbook(root.XLSX.read(fr.result, { type: 'array', cellDates: false }))); }
        catch (e) { reject(e); }
      };
      fr.readAsArrayBuffer(file);
    }); });
  }

  /* --------------------------------------------------------- export */
  function monthLabel(d) { var x = new Date(d + 'T00:00:00'); return x.toLocaleDateString('en-GB', { month: 'short' }) + '-' + String(x.getFullYear()).slice(2); }
  /* The upload layout: Month, Date, Expense, Amount (negative = spent), Category, Remarks. */
  function toAOA(rows) {
    return [['Month', 'Date', 'Expense', 'Amount', 'Category', 'Remarks']].concat(rows.map(function (r) {
      return [monthLabel(r.d), r.d, r.descr, Math.round(r.amount_minor) / 100, r.cat || '', r.remark || ''];
    }));
  }
  function download(aoa, name) {
    return ensureXLSX().then(function (X) {
      var wb = X.utils.book_new(), ws = X.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [{ wch: 8 }, { wch: 12 }, { wch: 34 }, { wch: 10 }, { wch: 12 }, { wch: 16 }];
      X.utils.book_append_sheet(wb, ws, 'Expense History');
      X.writeFile(wb, name);
    }).catch(function (e) { if (root.TN && root.TN.toast) root.TN.toast(e.message, 'error'); });
  }
  function exportAll(rows) {
    return download(toAOA(rows), 'Kept_Export_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  }
  /* A small fictional file in the exact upload layout. */
  function sampleRows(today) {
    var ym = String(today || new Date().toISOString()).slice(0, 7);
    var mm = function (d) { return ym + '-' + String(d).padStart(2, '0'); };
    return [
      [mm(1), 'SALARY — ACME ENGINEERING', 950000, 'Income', ''],
      [mm(2), 'CASHBACK REWARD', 4500, 'Income', 'refund'],
      [mm(3), 'GREENVIEW RESIDENCES RENT', -300000, 'Rent', ''],
      [mm(4), 'HOME LOAN EMI', -85000, 'Loan', 'emi 7/48'],
      [mm(5), 'CITY HYPERMARKET', -42000, 'Grocery', 'weekly shop'],
      [mm(6), 'METRO CARD TOP-UP', -10000, 'Transport', ''],
      [mm(7), 'SUNRISE CAFETERIA', -1400, 'Food', 'tea'],
      [mm(8), 'NOON ORDER — HEADPHONES', -26000, 'Shopping', ''],
      [mm(9), 'ELECTRICITY & WATER', -31000, 'Utilities', ''],
      [mm(10), 'PHARMACY PLUS', -6500, 'Medicine', ''],
      [mm(11), 'PETROL — CITY FUEL', -17000, 'Fuel', ''],
      [mm(12), 'FAMILY DINNER — AL NOOR RESTAURANT', -18000, 'Food', 'weekend'],
      [mm(14), 'INDEX FUND SIP', -50000, 'Investment', 'monthly'],
      [mm(18), 'CINEMA TICKETS', -9000, 'Entertainment', ''],
      [mm(21), 'CITY HYPERMARKET', -38000, 'Grocery', ''],
      [mm(25), 'MOBILE PLAN', -9900, 'Utilities', '']
    ].map(function (r) { return { d: r[0], descr: r[1], amount_minor: r[2], cat: r[3], remark: r[4] }; });
  }
  function sample() { return download(toAOA(sampleRows()), 'Kept_Sample.xlsx'); }

  root.KeptImport = { COLMAP: COLMAP, mapCols: mapCols, toISO: toISO, toMinor: toMinor, rowsFromAOA: rowsFromAOA,
    parseWorkbook: parseWorkbook, readFile: readFile, toAOA: toAOA, download: download, exportAll: exportAll, sampleRows: sampleRows, sample: sample,
    ensureXLSX: ensureXLSX };
})(typeof window !== 'undefined' ? window : globalThis);
