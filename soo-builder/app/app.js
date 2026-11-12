/* SOO Builder editor page. Uses SooEngine (engine.js) for every rule; this file is screens only. */
(function () {
  'use strict';
  const E = window.SooEngine;
  const $ = (s, el) => (el || document).querySelector(s);
  const h = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage off: fine */ } },
  };

  const STAGES = [
    { n: 1, name: 'Units and draft review' },
    { n: 2, name: 'Sequence' },
    { n: 3, name: 'Points list' },
    { n: 4, name: 'Library check' },
    { n: 5, name: 'Issue' },
  ];

  // ------------------------------------------------------------ state
  let lib = E.loadLibrary(store.get('soo.library') || window.SOO_LIBRARY_CSV);
  let libName = store.get('soo.libraryName') || 'Seed library (from the build brief)';
  let job = loadDraftJob() || E.newJob();
  let stage = Number(store.get('soo.stage')) || 1;
  let sideTab = 'checks';
  let undo = [];
  let fileHandle = null;
  let ui = { editing: null, card: null, blankIdx: 0, addingTo: null, cell: null, addPoint: false, review: null };

  function loadDraftJob() {
    try { const t = store.get('soo.job'); return t ? JSON.parse(t) : null; } catch (e) { return null; }
  }

  /** Every change goes through here: undo snapshot, revision flag, later stages need another look. */
  function change(fromStage, fn) {
    undo.push(JSON.stringify(job));
    if (undo.length > 150) undo.shift();
    fn(job);
    if (job.issued.length) job.changedSinceIssue = true;
    for (const k of Object.keys(job.signoff)) if (Number(k) > fromStage && job.signoff[k]) job.signoff[k].recheck = true;
    persist();
    render();
  }
  function persist() { store.set('soo.job', JSON.stringify(job)); store.set('soo.stage', String(stage)); }
  function doUndo() {
    const prev = undo.pop();
    if (!prev) { toast('Nothing to undo.'); return; }
    job = JSON.parse(prev); ui.editing = null; ui.card = null; persist(); render(); toast('Undone.');
  }
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2600);
  }
  const unlocked = (n) => STAGES.filter((s) => s.n < n).every((s) => job.signoff[s.n]);

  // ------------------------------------------------------------ chrome
  function render() {
    $('#jobLabel').textContent = (job.code || 'New job') + (job.title ? ': ' + job.title : '') + (job.revision ? '  ·  Rev ' + job.revision : '');
    $('#steps').innerHTML = STAGES.map((s) => {
      const so = job.signoff[s.n];
      const cls = ['step', s.n === stage ? 'on' : '', unlocked(s.n) ? '' : 'locked'].join(' ');
      return '<button class="' + cls + '" data-act="stage" data-n="' + s.n + '" title="' + (unlocked(s.n) ? '' : 'Sign off the stage before this one first') + '">' + s.n + '. ' + h(s.name)
        + (so ? (so.recheck ? '<span class="re" title="Something earlier changed. Look again.">●</span>' : '<span class="tick">✓</span>') : '') + '</button>';
    }).join('');
    const b = $('#banner');
    if (job.changedSinceIssue && job.issued.length) {
      b.hidden = false;
      b.textContent = 'Changed since Rev ' + job.revision + '. Reissue the sequence, points list and schematics together as Rev ' + nextRev(job.revision) + '.';
    } else b.hidden = true;
    const main = $('#main');
    const scroll = window.scrollY;
    if (stage === 1) main.innerHTML = stageUnits();
    else if (stage === 2) main.innerHTML = stageSequence();
    else if (stage === 3) main.innerHTML = stagePoints();
    else if (stage === 4) main.innerHTML = stageLibrary();
    else main.innerHTML = stageIssue();
    window.scrollTo(0, scroll);
    const focus = $('[data-autofocus]');
    if (focus) { focus.focus(); if (focus.select && focus.tagName === 'INPUT') focus.select(); }
  }

  function footer(n, note) {
    const so = job.signoff[n];
    return '<div class="stage-foot"><div class="muted">' + (note || '') + '</div><div>'
      + (so && !so.recheck ? '<span class="chip ok">Signed off ' + h(so.date) + '</span> ' : '')
      + (n < 5 ? '<button class="btn ok" data-act="signoff" data-n="' + n + '">' + (so ? 'Sign off again and continue' : 'Sign off and continue') + ' ›</button>' : '')
      + '</div></div>';
  }

  // ------------------------------------------------------------ stage 1: units and draft review
  function stageUnits() {
    const ahus = E.ahuUnits(job);
    const others = job.units.filter((u) => u.type !== E.TYPE_AHU);
    const otherTypes = lib.types.filter((t) => ![E.TYPE_AHU, E.TYPE_CU, E.TYPE_GENERAL].includes(t.name));
    const cb = (u, k, title) => '<td class="c"><input type="checkbox" data-unit="' + u.id + '" data-k="' + k + '"' + (u[k] ? ' checked' : '') + ' title="' + h(title) + '"></td>';
    const tx = (u, k, w, num) => '<td><input type="' + (num ? 'number' : 'text') + '" data-unit="' + u.id + '" data-k="' + k + '" value="' + h(u[k]) + '" style="min-width:' + w + 'em"></td>';
    let s = '<section class="stage"><h1>Units and draft review</h1><div class="muted">Enter what the equipment schedules say. Schedule values govern over the draft sequence.</div>';
    s += '<h2>Job</h2><div class="fields">'
      + '<div class="field"><label>Job code (neutral, used as the library source tag)</label><input type="text" data-job="code" value="' + h(job.code) + '" placeholder="JOB-B"></div>'
      + '<div class="field"><label>Short title (optional)</label><input type="text" data-job="title" value="' + h(job.title) + '"></div>'
      + '<div class="field"><label>&nbsp;</label><label class="check"><input type="checkbox" data-job="government"' + (job.government ? ' checked' : '') + '> Government or military job</label>'
      + '<label class="check"><input type="checkbox" data-job="humid"' + (job.humid ? ' checked' : '') + '> Humid climate</label></div></div>';

    s += '<h2>Split heat pump AHUs <span class="muted small">(one typical sequence)</span></h2>';
    if (!ahus.length) s += '<div class="empty">No AHUs yet.</div>';
    else {
      s += '<div class="tbl-wrap"><table class="grid"><thead><tr><th>AHU</th><th>CU</th><th title="Compressor stages">Comp. stages</th><th title="Electric heat stages (0 for none)">Elec. heat stages</th><th>Supply CFM</th><th>OA CFM</th><th>Cooling MBH</th>'
        + '<th class="c" title="Return air temperature sensor">RA temp</th><th class="c" title="Return air humidity sensor">RA RH</th><th class="c" title="Zone sensor with override button">Override</th><th class="c" title="Outside airflow measuring station">OA flow sta.</th><th class="c" title="High static pressure switch">High static</th><th class="c" title="Supply duct smoke detector">Supply SD</th><th class="c" title="Return duct smoke detector">Return SD</th><th class="c" title="Condensate overflow switch">Cond. switch</th><th></th></tr></thead><tbody>';
      for (const u of ahus) {
        s += '<tr>' + tx(u, 'tag', 6) + tx(u, 'cu', 6)
          + '<td><select data-unit="' + u.id + '" data-k="compStages">' + [1, 2, 3, 4].map((n) => '<option' + (Number(u.compStages) === n ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></td>'
          + '<td><select data-unit="' + u.id + '" data-k="heatStages">' + [0, 1, 2, 3, 4].map((n) => '<option' + (Number(u.heatStages) === n ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></td>'
          + tx(u, 'cfm', 5, true) + tx(u, 'oaCfm', 5, true) + tx(u, 'coolingMbh', 5, true)
          + cb(u, 'rat', 'Return air temperature sensor') + cb(u, 'rh', 'Return air humidity sensor') + cb(u, 'override', 'Override button') + cb(u, 'oaFlow', 'OA flow station') + cb(u, 'highStatic', 'High static switch')
          + cb(u, 'supplySd', 'Supply smoke detector') + cb(u, 'returnSd', 'Return smoke detector') + cb(u, 'condOverflow', 'Condensate overflow switch')
          + '<td class="act"><button class="iconbtn" data-act="del-unit" data-id="' + u.id + '" title="Remove this unit (Undo puts it back)">×</button></td></tr>';
      }
      s += '</tbody></table></div>';
    }
    s += '<button class="k-add" data-act="add-ahu">+ Add an AHU</button>';

    s += '<h2>Other equipment <span class="muted small">(points from the library; no sequence template yet)</span></h2>';
    if (!others.length) s += '<div class="empty">None. Add mini-splits, exhaust fans, water heaters and so on.</div>';
    for (const u of others) {
      const conds = E.conditionsFor(lib, u.type);
      s += '<div class="finding"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">'
        + '<input type="text" data-unit="' + u.id + '" data-k="tag" value="' + h(u.tag) + '" placeholder="Tag(s), e.g. EF-1,2" style="width:12em">'
        + '<select data-unit="' + u.id + '" data-k="type">' + otherTypes.map((t) => '<option' + (t.name === u.type ? ' selected' : '') + '>' + h(t.name) + '</option>').join('') + '</select>'
        + '<span style="flex:1"></span><button class="iconbtn" data-act="del-unit" data-id="' + u.id + '" title="Remove (Undo puts it back)">×</button></div>'
        + (conds.length ? '<div style="margin-top:6px">' + conds.map((c) => '<label class="check small"><input type="checkbox" data-cond="' + h(c) + '" data-unit="' + u.id + '"' + (u.conditions[c] ? ' checked' : '') + '> ' + h(c) + '</label>').join('') + '</div>' : '')
        + '</div>';
    }
    s += '<div style="display:flex;gap:6px;align-items:center"><select id="newType">' + otherTypes.map((t) => '<option>' + h(t.name) + '</option>').join('') + '</select><button class="btn ghost" data-act="add-other">+ Add equipment</button></div>';

    s += '<h2>Building</h2><div>'
      + '<label class="check"><input type="checkbox" data-gen="waterMeter"' + (job.general.waterMeter ? ' checked' : '') + '> Building water meter tied to DDC</label>'
      + '<label class="check"><input type="checkbox" data-gen="meterAlarm"' + (job.general.meterAlarm ? ' checked' : '') + '> Meter has an alarm contact</label></div>'
      + '<div class="field" style="max-width:520px;margin-top:10px"><label>Dampers closed by the emergency HVAC shutdown switch, one per line (each gets an end switch point)</label><textarea rows="3" data-gen="esdsDampers">' + h((job.general.esdsDampers || []).join('\n')) + '</textarea></div>';

    s += '<h2>Draft sequence review</h2><div class="muted small">Paste the draft (text from the CAD sheet or PDF). For screenshots, the Claude skill reads them and fills this in.</div>'
      + '<textarea rows="8" data-job="draft" placeholder="Paste the draft sequence here">' + h(job.draft) + '</textarea>'
      + '<div style="margin-top:6px;display:flex;gap:6px"><button class="btn" data-act="review">Review the draft</button><button class="btn ghost" data-act="load-draft">Open a text file</button></div>';
    if (job.review && job.review.length) {
      for (const g of ['Conflict', 'Gap', 'Cleanup']) {
        const items = job.review.filter((r) => r.group === g);
        if (!items.length) continue;
        s += '<h3>' + (g === 'Conflict' ? 'Conflicts' : g === 'Gap' ? 'Gaps' : 'Cleanup') + ' <span class="chip">' + items.length + '</span></h3>';
        for (const r of items) {
          s += '<div class="finding ' + g + '"><div>' + h(r.text) + '</div>' + (r.quote ? '<div class="quote">"' + h(r.quote) + '"</div>' : '')
            + '<input type="text" class="small" style="width:100%;margin-top:4px" data-review="' + h(r.text) + '" value="' + h(job.reviewNotes[r.text] || '') + '" placeholder="How it was resolved (optional, goes in the decision log)"></div>';
        }
      }
    } else if (job.review) s += '';
    s += footer(1, ahus.length ? ahus.length + ' AHU' + (ahus.length === 1 ? '' : 's') + ', ' + others.length + ' other' : 'Add the units first.');
    return s + '</section>';
  }

  // ------------------------------------------------------------ stage 2: sequence
  function stageSequence() {
    if (!E.ahuUnits(job).length) return '<section class="stage"><h1>Sequence</h1><div class="empty">No split heat pump AHUs on this job, so there is no sequence to write from the template. Other equipment goes straight to the points list.</div>' + footer(2) + '</section>';
    const seq = E.finalSequence(job);
    const gen = E.generateSequence(job);
    const checks = E.checkJob(job, lib);
    const fixN = checks.filter((c) => c.level === 'fix').length;
    const openD = E.openDecisions(job).length;
    let p = '<div class="page" id="page">';
    seq.header.forEach((t) => { p += '<div class="hdr">' + litText(t, null) + '</div>'; });
    for (const s of gen.sections) {
      const fs = seq.sections.find((x) => x.key === s.key);
      p += '<div class="sec-title">' + h(s.title) + '</div>';
      let n = 0;
      for (const it of s.items) {
        if (job.removed[it.id]) { p += paraRemoved(it); continue; }
        const f = fs.items.find((x) => x.id === it.id);
        n++;
        p += para(f, String(n) + '.', false);
        let k = 0;
        for (const sub of it.subs) {
          if (job.removed[sub.id]) { p += paraRemoved(sub, true); continue; }
          const fx = f.subs.find((x) => x.id === sub.id);
          p += para(fx, String.fromCharCode(65 + k) + '.', true);
          k++;
        }
      }
      for (const a of fs.items.filter((x) => x.added)) { n++; p += para(a, String(n) + '.', false); }
      if (ui.addingTo === s.key) {
        p += '<div class="card edit-box"><div class="small muted">New paragraph in ' + h(s.title.toLowerCase()) + '</div><textarea id="newPara" data-autofocus></textarea><div class="row"><button class="btn ghost small" data-act="cancel-add">Cancel</button><button class="btn small" data-act="save-add" data-sec="' + s.key + '">Add</button></div></div>';
      } else p += '<button class="k-add" data-act="add-para" data-sec="' + s.key + '" style="font-family:var(--ui-font)">+ Add a paragraph</button>';
    }
    p += '</div>';
    let side = '<div class="side"><div class="side-tabs">'
      + '<button class="' + (sideTab === 'checks' ? 'on' : '') + '" data-act="side" data-tab="checks">Checks' + (fixN ? ' (' + fixN + ')' : '') + '</button>'
      + '<button class="' + (sideTab === 'decisions' ? 'on' : '') + '" data-act="side" data-tab="decisions">Decisions' + (openD ? ' (' + openD + ')' : '') + '</button>'
      + '<button class="' + (sideTab === 'values' ? 'on' : '') + '" data-act="side" data-tab="values">Values</button></div>';
    if (sideTab === 'checks') side += checksPanel(checks);
    else if (sideTab === 'decisions') side += decisionsPanel();
    else side += valuesPanel();
    side += '</div>';
    return '<section class="stage"><h1>Sequence</h1><div class="muted small">Lit text is a blank to fill. Double-click a paragraph to write your own wording. Undo with Ctrl+Z.</div>'
      + '<div class="seq-layout" style="margin-top:12px"><div>' + p + '</div>' + side + '</div>'
      + footer(2, fixN ? fixN + ' to fix before issue' : 'No items to fix') + '</section>';
  }

  function litText(text, ownerId) {
    const blanks = E.blanksIn(text);
    if (!blanks.length) return h(text);
    let out = '', last = 0;
    blanks.forEach((b, i) => {
      out += h(text.slice(last, b.start));
      const cur = ui.card && ui.card.id === ownerId && ui.card.i === i;
      out += '<span class="blank' + (cur ? ' cur' : '') + '" data-act="blank" data-id="' + h(ownerId || '') + '" data-i="' + i + '" title="Click to fill in">' + h(b.raw) + '</span>';
      last = b.end;
    });
    return out + h(text.slice(last));
  }

  function para(it, num, sub) {
    const cls = ['para', sub ? 'sub' : '', it.added ? 'added' : it.edited ? 'edited' : '', ui.editing === it.id ? 'open' : ''].join(' ');
    let body;
    if (ui.editing === it.id) {
      body = '<div class="edit-box"><textarea id="editBox" data-autofocus>' + h(it.text) + '</textarea><div class="row">'
        + (it.edited && !it.added ? '<button class="btn ghost small" data-act="revert" data-id="' + it.id + '">Back to the template wording</button>' : '')
        + '<button class="btn ghost small" data-act="cancel-edit">Cancel</button><button class="btn small" data-act="save-edit" data-id="' + it.id + '">Save</button></div></div>';
    } else {
      body = '<div data-act="dbl" data-id="' + it.id + '">' + litText(it.text, it.id)
        + (it.stale ? '<div class="stale-note">The template wording here changed after your edit. <button class="linkbtn" data-act="show-gen" data-id="' + it.id + '">Compare</button></div>' : '')
        + (ui.showGen === it.id ? '<div class="stale-note">Template now says: ' + h(it.generated) + '</div>' : '') + '</div>';
    }
    let s = '<div class="' + cls + '" id="p-' + it.id + '"><div class="num">' + num + '</div>' + body
      + '<div class="acts"><button class="iconbtn" data-act="edit" data-id="' + it.id + '" title="Write your own wording">✎</button>'
      + '<button class="iconbtn" data-act="remove" data-id="' + it.id + '" data-added="' + (it.added ? 1 : 0) + '" title="Remove this paragraph (Put back or Undo restores it)">×</button></div></div>';
    if (ui.card && ui.card.id === it.id) s += blankCard(it);
    return s;
  }

  function paraRemoved(it, sub) {
    return '<div class="para removed' + (sub ? ' sub' : '') + '"><div class="num">–</div><div>' + h(it.text) + '</div><div class="acts" style="visibility:visible"><button class="linkbtn small" data-act="putback" data-id="' + it.id + '">Put back</button></div></div>';
  }

  function blankCard(it) {
    const blanks = E.blanksIn(it.text);
    const b = blanks[ui.card.i];
    if (!b) return '';
    const nav = '<div class="keys">' + (ui.card.i + 1) + ' of ' + blanks.length + ' here · ← → other blanks · Esc closes</div>';
    if (b.kind === 'tbd') {
      const label = b.body.slice(4).trim();
      const v = E.VALUES.find((x) => x.label.toUpperCase() === label);
      return '<div class="card"><div><b>' + h(v ? v.label : label.toLowerCase()) + '</b>' + (v ? ' <span class="muted small">(' + ({ F: '°F', RH: '% RH', min: 'minutes', sec: 'seconds', secAdj: 'seconds', hr: 'hours', pct: '%' }[v.kind] || '') + ')</span>' : '') + '</div>'
        + '<div style="display:flex;gap:6px;margin:6px 0"><input type="text" id="blankVal" data-autofocus style="flex:1" placeholder="' + (v ? 'Value' : 'Text') + '"><button class="btn small" data-act="fill" data-id="' + it.id + '" data-key="' + (v ? v.key : '') + '">Fill in</button></div>' + nav + '</div>';
    }
    if (b.kind === 'choice') {
      return '<div class="card"><div><b>Choose the wording</b></div><div class="opts">' + b.options.map((o, i) => '<button class="opt' + (i === (ui.card.lit || 0) ? ' lit' : '') + '" data-act="choose" data-id="' + it.id + '" data-o="' + i + '">' + (i + 1) + '. ' + h(o) + '</button>').join('') + '</div>' + nav + '</div>';
    }
    return '<div class="card"><div><b>Optional paragraph</b> <span class="muted small">' + h(b.body.slice(9).trim()) + '</span></div><div class="opts"><button class="opt lit" data-act="keep-opt" data-id="' + it.id + '">Keep it</button><button class="opt" data-act="del-opt" data-id="' + it.id + '">Delete the paragraph (D)</button></div>' + nav + '</div>';
  }

  function checksPanel(checks) {
    if (!checks.length) return '<div class="empty">✓ No checks to show.</div>';
    const order = { fix: 0, look: 1, info: 2 };
    checks.sort((a, b) => order[a.level] - order[b.level]);
    return '<div class="small muted" style="margin-bottom:6px">Red: fix before issue. Amber: look at it.</div>' + checks.map((c) => '<div class="finding ' + c.level + (c.ref ? ' clickable' : '') + '"' + (c.ref ? ' data-act="goto" data-ref="' + h(c.ref) + '"' : '') + '><div class="area">' + h(c.area) + '</div>' + h(c.text) + '</div>').join('');
  }

  function decisionsPanel() {
    let s = '';
    for (const d of E.DECISIONS) {
      if (d.when && !d.when(job)) continue;
      const cur = E.decision(job, d.key);
      const rec = d.recommend(job);
      const conf = job.confirmed[d.key];
      s += '<div class="decision' + (conf ? '' : ' open') + '" id="d-' + d.key + '"><div class="q">' + h(d.ask) + (conf ? ' <span class="chip ok">confirmed</span>' : ' <span class="chip warn">to confirm</span>') + '</div>';
      const opts = d.options.slice().sort((a, b) => (a.value === rec ? -1 : b.value === rec ? 1 : 0));
      for (const o of opts) s += '<button class="opt' + (cur === o.value && conf ? ' sel' : '') + '" data-act="decide" data-key="' + d.key + '" data-v="' + h(o.value) + '">' + h(o.label) + (o.value === rec ? ' <span class="chip accent">Recommended</span>' : '') + (o.hint ? '<span class="hint">' + h(o.hint) + '</span>' : '') + '</button>';
      s += '</div>';
    }
    s += '<div class="small muted">Cooling control is zone temperature with a coil low limit (the template). A fixed supply air temperature strategy is not in the template; write it by hand if needed.</div>';
    return s;
  }

  function valuesPanel() {
    let s = '<div class="small muted" style="margin-bottom:6px">Office defaults shown. Every value prints with (ADJ.). Lockouts have no default: always ask.</div><table class="grid values">';
    let g = null;
    for (const v of E.VALUES) {
      if (v.group !== g) { g = v.group; s += '<tr class="sec"><td colspan="2">' + h(g) + '</td></tr>'; }
      const cur = job.values[v.key];
      const empty = (cur == null || cur === '') && v.def == null;
      s += '<tr class="' + (empty ? 'ask' : '') + '"><td>' + h(v.label) + '</td><td><input type="number" step="any" data-val="' + v.key + '" value="' + h(cur != null && cur !== '' ? cur : '') + '" placeholder="' + (v.def == null ? 'ask' : v.def) + '"></td></tr>';
    }
    return s + '</table>';
  }

  // ------------------------------------------------------------ stage 3: points list
  function stagePoints() {
    const rows = E.pointRows(job, lib);
    const checks = E.checkJob(job, lib).filter((c) => ['Cross-check', 'Points list'].includes(c.area));
    let t = '<div class="tbl-wrap"><table class="grid"><thead><tr><th>Equipment</th><th>POINT DESCRIPTIONS</th><th class="c">POINT</th><th class="c">UNITS</th><th class="c">TREND</th><th class="c">ALARM</th><th></th></tr></thead><tbody>';
    for (const r of rows) {
      if (r.kind === 'section') { t += '<tr class="sec"><td></td><td colspan="6">' + h(r.title) + '</td></tr>'; continue; }
      const cls = r.removed ? 'removed' : r.added ? 'added' : r.edited ? 'edited' : '';
      const cell = (f, c) => {
        if (ui.cell && ui.cell.key === r.key && ui.cell.f === f) {
          if (f === 'point') return '<td class="c"><select data-cell="' + h(r.key) + '" data-f="point" data-autofocus>' + ['AI', 'AO', 'DI', 'DO', 'AV', 'DO / DI'].map((x) => '<option' + (x === r.point ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></td>';
          return '<td><input type="text" data-cell="' + h(r.key) + '" data-f="' + f + '" value="' + h(r[f]) + '" data-autofocus></td>';
        }
        return '<td class="' + (c || '') + '" data-edit="1" data-act="cell" data-key="' + h(r.key) + '" data-f="' + f + '" title="Click to change">' + h(r[f]) + '</td>';
      };
      t += '<tr class="' + cls + '">' + cell('equipment') + cell('desc') + cell('point', 'c') + cell('units', 'c')
        + '<td class="c"><input type="checkbox" data-flag="trend" data-key="' + h(r.key) + '"' + (r.trend ? ' checked' : '') + (r.removed ? ' disabled' : '') + '></td>'
        + '<td class="c"><input type="checkbox" data-flag="alarm" data-key="' + h(r.key) + '"' + (r.alarm ? ' checked' : '') + (r.removed ? ' disabled' : '') + '></td>'
        + '<td class="act">' + (r.removed ? '<button class="linkbtn small" data-act="row-back" data-key="' + h(r.key) + '">Put back</button>'
          : (r.edited ? '<button class="iconbtn" data-act="row-revert" data-key="' + h(r.key) + '" title="Back to the generated row">↺</button>' : '')
          + '<button class="iconbtn" data-act="row-del" data-key="' + h(r.key) + '" title="Remove this row">×</button>') + '</td></tr>';
    }
    t += '</tbody></table></div>';
    let add = '';
    if (ui.addPoint) {
      const types = lib.types.map((x) => x.name);
      add = '<div class="card" style="margin-left:0"><b>Add a point</b><div class="fields" style="margin-top:8px">'
        + '<div class="field"><label>Equipment</label><input type="text" id="apEq" placeholder="AHU-1,2,3" data-autofocus></div>'
        + '<div class="field" style="grid-column:span 2"><label>Point description</label><input type="text" id="apDesc"></div>'
        + '<div class="field"><label>Point</label><select id="apPoint">' + ['AI', 'AO', 'DI', 'DO', 'AV'].map((x) => '<option>' + x + '</option>').join('') + '</select></div>'
        + '<div class="field"><label>Units</label><input type="text" id="apUnits" list="unitsList"><datalist id="unitsList">' + ['ON/OFF', 'OFF/ON', 'OK/ALARM', 'OK/FAULT', 'OK/REPLACE', 'HEAT/COOL', 'COOL/HEAT', 'OPEN/CLOSED', 'START/STOP', 'AUTO/HAND', '°F', '%RH', '%', 'CFM', 'GPM', 'GALLONS', 'PSI', 'IN. W.G.'].map((x) => '<option>' + h(x) + '</option>').join('') + '</datalist></div>'
        + '<div class="field"><label>Equipment type (for the library)</label><input type="text" id="apType" list="typeList" placeholder="New type or pick one"><datalist id="typeList">' + types.map((x) => '<option>' + h(x) + '</option>').join('') + '</datalist></div>'
        + '<div class="field"><label>Applies when</label><input type="text" id="apApplies" placeholder="Always"></div>'
        + '<div class="field"><label>Section</label><select id="apSec"><option value="HVAC">HVAC</option><option value="PLUMBING">Plumbing</option><option value="GENERAL">General building</option></select></div>'
        + '<div class="field"><label>&nbsp;</label><label class="check"><input type="checkbox" id="apTrend" checked> Trend</label><label class="check"><input type="checkbox" id="apAlarm"> Alarm</label></div></div>'
        + '<div style="display:flex;justify-content:flex-end;gap:6px;margin-top:8px"><button class="btn ghost small" data-act="cancel-point">Cancel</button><button class="btn small" data-act="save-point">Add the point</button></div></div>';
    } else add = '<button class="k-add" data-act="add-point">+ Add a point</button>';
    return '<section class="stage"><h1>Points list</h1><div class="muted small">Built from the units and the sequence. Identical units share a row; differences get their own row. Click a cell to change it.</div>'
      + '<div class="seq-layout" style="margin-top:12px"><div>' + t + add + '</div><div class="side"><h3 style="margin-top:0">Sequence and points agree?</h3>' + (checks.length ? checksPanel(checks) : '<div class="empty">✓ Every sequence feature has its points, and every control point is used.</div>') + '</div></div>'
      + footer(3, E.activeRows(rows).filter((r) => r.kind === 'point').length + ' points') + '</section>';
  }

  // ------------------------------------------------------------ stage 4: library check
  function stageLibrary() {
    const missing = E.libraryCheck(job, lib);
    const answered = missing.filter((m) => m.answer).length;
    let s = '<section class="stage"><h1>Library check</h1><div class="muted small">Points the master library holds for this job\'s equipment that are not on the points list. Does each one apply? Library: ' + h(libName) + '.</div>';
    if (!missing.length) s += '<div class="empty" style="margin-top:12px">✓ Every library point for this job\'s equipment is on the list.</div>';
    const types = [...new Set(missing.map((m) => m.type))];
    for (const t of types) {
      s += '<div class="libtype"><h3>' + h(t) + '</h3>';
      for (const m of missing.filter((x) => x.type === t)) {
        s += '<div class="libpoint ' + (m.answer || '') + '"><div class="what"><b>' + h(m.point.desc) + '</b> <span class="muted small">' + h(m.point.point) + ', ' + h(m.point.units) + '. Applies when: ' + h(m.point.applies) + '</span></div>'
          + (m.answer === 'yes' ? '<span class="chip ok">Added</span>' : m.answer === 'no' ? '<span class="chip">Not used on this job</span>' : '')
          + '<button class="btn small' + (m.answer === 'yes' ? '' : ' ghost') + '" data-act="lib-yes" data-key="' + h(m.key) + '">Applies</button>'
          + '<button class="btn small ghost" data-act="lib-no" data-key="' + h(m.key) + '">Does not apply</button></div>';
      }
      s += '</div>';
    }
    const newPts = job.extraPoints.filter((x) => !x.libDesc);
    s += '<h2>New points for the library</h2>';
    s += newPts.length ? '<ul>' + newPts.map((x) => '<li>' + h(x.type || 'Other') + ': ' + h(x.desc) + ' (' + h(x.point) + ', ' + h(x.units) + ')</li>').join('') + '</ul><div class="muted small">Added to the library with the job code when the job is issued.</div>' : '<div class="muted">None. Points added by hand on the points list show here.</div>';
    s += footer(4, missing.length ? answered + ' of ' + missing.length + ' answered' : '');
    return s + '</section>';
  }

  // ------------------------------------------------------------ stage 5: issue
  function nextRev(r) { if (!r) return 'A'; return String.fromCharCode(r.charCodeAt(0) + 1); }
  function stageIssue() {
    const checks = E.checkJob(job, lib);
    const fix = checks.filter((c) => c.level === 'fix');
    const seq = E.finalSequence(job);
    const rev = job.issued.length && !job.changedSinceIssue ? job.revision : nextRev(job.revision);
    const lc = E.libraryCheck(job, lib).filter((m) => !m.answer);
    let s = '<section class="stage"><h1>Issue</h1>';
    s += '<div class="two"><div>';
    s += '<h2>Rev ' + h(rev) + '</h2>';
    if (fix.length) s += '<div class="finding fix">' + fix.length + ' item' + (fix.length === 1 ? '' : 's') + ' to fix. They print as written. <button class="linkbtn" data-act="stage" data-n="2">Go to the sequence checks</button></div>';
    if (lc.length) s += '<div class="finding look">' + lc.length + ' library point' + (lc.length === 1 ? '' : 's') + ' not answered. <button class="linkbtn" data-act="stage" data-n="4">Go to the library check</button></div>';
    s += '<div class="field"><label>What changed in this revision</label><textarea rows="3" id="revChanges" placeholder="' + (job.issued.length ? 'For example: added return smoke detector to AHU-2' : 'First issue') + '"></textarea></div>';
    s += '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap"><button class="btn" data-act="issue">Issue Rev ' + h(rev) + ' and save the files</button><button class="btn ghost" data-act="save-files">Save the files without issuing</button></div>';
    s += '<ul class="files muted small" style="margin-top:12px"><li>Sequence (Word): in Revit or AutoCAD use <b>Link Word Notes</b>. Tick <b>Include the lines above note 1</b> to bring in the title, the TYPICAL FOR line and GENERAL.</li>'
      + '<li>Points list (Excel): use <b>Link Excel Schedule</b>. Notes and abbreviations sit below the table.</li><li>Decision log, plain-text sequence, and the master library with this job\'s new points.</li></ul>';
    s += '<h2>Open items</h2>';
    const eng = E.engineeringChecks(job);
    s += (job.openItems || []).map((o, i) => '<label class="check" style="display:flex"><input type="checkbox" data-open="' + i + '"' + (o.done ? ' checked' : '') + '> ' + h(o.text) + '</label>').join('');
    s += eng.map((e) => '<div class="finding look small">' + h(e.text) + '</div>').join('');
    s += '<div style="display:flex;gap:6px;margin-top:6px"><input type="text" id="newOpen" placeholder="Add an open item" style="flex:1"><button class="btn ghost small" data-act="add-open">Add</button></div>';
    if (job.issued.length) s += '<h2>Issued</h2><ul>' + job.issued.map((i) => '<li>Rev ' + h(i.rev) + ', ' + h(i.date) + ': ' + h(i.changes || 'Issued') + '</li>').join('') + '</ul>';
    s += '</div><div><h2>Sequence text <button class="btn ghost small" data-act="copy-seq">Copy</button></h2><pre class="copy" id="seqText">' + h(E.sequenceText(seq)) + '</pre></div></div>';
    s += footer(5);
    return s + '</section>';
  }

  // ------------------------------------------------------------ files
  function download(name, data, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  async function saveFiles() {
    const files = E.outputs(job, lib);
    if (window.showDirectoryPicker) {
      try {
        const dir = await window.showDirectoryPicker({ id: 'soo-out', mode: 'readwrite' });
        for (const f of files) {
          const fh = await dir.getFileHandle(f.name, { create: true });
          const w = await fh.createWritable(); await w.write(f.data); await w.close();
        }
        toast('✓ ' + files.length + ' files saved to the folder.');
        return true;
      } catch (e) {
        if (e && e.name === 'AbortError') return false;
      }
    }
    files.forEach((f, i) => setTimeout(() => download(f.name, f.data), i * 400));
    toast('✓ ' + files.length + ' files downloaded.');
    return true;
  }

  async function saveJob() {
    const text = JSON.stringify(job, null, 1);
    const name = (job.code || 'JOB') + ' SOO job.json';
    if (window.showSaveFilePicker) {
      try {
        if (!fileHandle) fileHandle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'SOO Builder job', accept: { 'application/json': ['.json'] } }] });
        const w = await fileHandle.createWritable(); await w.write(text); await w.close();
        toast('✓ Job saved.'); return;
      } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    download(name, text, 'application/json'); toast('✓ Job file downloaded.');
  }

  function readFile(input, cb) {
    const f = input.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { cb(String(r.result), f.name); input.value = ''; };
    r.readAsText(f);
  }

  // ------------------------------------------------------------ events
  function setUnit(id, k, v) { change(1, (j) => { const u = j.units.find((x) => x.id === id); if (u) u[k] = v; }); }

  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.dataset.job) { const k = t.dataset.job; change(1, (j) => { j[k] = t.type === 'checkbox' ? t.checked : t.value; }); return; }
    if (t.dataset.cond) { change(1, (j) => { const u = j.units.find((x) => x.id === t.dataset.unit); u.conditions[t.dataset.cond] = t.checked; }); return; }
    if (t.dataset.unit) {
      const k = t.dataset.k;
      let v = t.type === 'checkbox' ? t.checked : t.value;
      if (k === 'type') { change(1, (j) => { const u = j.units.find((x) => x.id === t.dataset.unit); u.type = v; u.conditions = {}; }); return; }
      if (['compStages', 'heatStages'].includes(k)) v = Number(v);
      if (k === 'tag' || k === 'cu') v = v.toUpperCase();
      setUnit(t.dataset.unit, k, v); return;
    }
    if (t.dataset.gen) {
      const k = t.dataset.gen;
      change(1, (j) => { j.general[k] = k === 'esdsDampers' ? t.value.split('\n').map((x) => x.trim().toUpperCase()).filter(Boolean) : t.checked; }); return;
    }
    if (t.dataset.review != null) { change(1, (j) => { j.reviewNotes[t.dataset.review] = t.value; }); return; }
    if (t.dataset.val) { const k = t.dataset.val; change(2, (j) => { if (t.value === '') delete j.values[k]; else j.values[k] = Number(t.value); }); return; }
    if (t.dataset.flag) { const f = t.dataset.flag; change(3, (j) => editRow(j, t.dataset.key, { [f]: t.checked })); return; }
    if (t.dataset.cell && t.tagName === 'SELECT') { saveCell(t); return; }
    if (t.dataset.open != null) { change(5, (j) => { j.openItems[Number(t.dataset.open)].done = t.checked; }); }
  });

  function editRow(j, key, patch) {
    if (key.startsWith('extra|')) {
      const x = j.extraPoints.find((p) => 'extra|' + p.id === key);
      if (x) Object.assign(x, patch);
      return;
    }
    j.pointEdits[key] = Object.assign({}, j.pointEdits[key] || {}, patch);
  }
  function saveCell(t) {
    const key = t.dataset.cell, f = t.dataset.f;
    let v = t.value;
    if (f === 'desc' || f === 'equipment') v = v.toUpperCase();
    ui.cell = null;
    change(3, (j) => editRow(j, key, { [f]: v }));
  }

  document.addEventListener('focusout', (ev) => {
    const t = ev.target;
    if (t.dataset && t.dataset.cell && t.tagName === 'INPUT') saveCell(t);
  });

  document.addEventListener('dblclick', (ev) => {
    const p = ev.target.closest('[data-act="dbl"]');
    if (p && !ev.target.closest('.blank')) { ui.editing = p.dataset.id; ui.card = null; render(); }
  });

  document.addEventListener('click', async (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    const a = el.dataset.act;
    const id = el.dataset.id;
    switch (a) {
      case 'stage': {
        const n = Number(el.dataset.n);
        if (!unlocked(n)) { toast('Sign off stage ' + (n - 1) + ' first.'); return; }
        stage = n; ui.card = null; ui.editing = null; persist(); render(); window.scrollTo(0, 0); return;
      }
      case 'signoff': {
        const n = Number(el.dataset.n);
        if (n === 1 && !job.code) { toast('Type the job code first.'); return; }
        change(n, (j) => { j.signoff[n] = { date: E.today() }; });
        stage = Math.min(5, n + 1); persist(); render(); window.scrollTo(0, 0); return;
      }
      case 'undo': doUndo(); return;
      case 'new-job':
        if (!confirm('Start a new job? Save this one first if you need it. Undo brings it back.')) return;
        change(0, () => {}); job = E.newJob(); fileHandle = null; stage = 1; persist(); render(); return;
      case 'open-job': $('#fileJob').click(); return;
      case 'save-job': saveJob(); return;
      case 'open-library': $('#fileLib').click(); return;
      case 'load-draft': $('#fileDraft').click(); return;
      case 'text-smaller': case 'text-larger': {
        const cur = parseFloat(getComputedStyle(document.documentElement).fontSize);
        const n = Math.max(11, Math.min(20, cur + (a === 'text-larger' ? 1 : -1)));
        document.documentElement.style.fontSize = n + 'px'; store.set('soo.textSize', String(n)); return;
      }
      case 'theme': {
        const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        const n = cur === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = n; store.set('soo.theme', n); return;
      }
      case 'add-ahu': change(1, (j) => { j.units.push(E.newAhu(E.ahuUnits(j).length + 1)); }); return;
      case 'add-other': { const t = $('#newType').value; change(1, (j) => { j.units.push(E.newUnit(t, '')); }); return; }
      case 'del-unit': change(1, (j) => { j.units = j.units.filter((u) => u.id !== id); }); toast('Unit removed. Undo puts it back.'); return;
      case 'review': {
        const draft = $('textarea[data-job="draft"]').value;
        change(1, (j) => { j.draft = draft; j.review = E.reviewDraft(draft, j); });
        toast(job.review.length + ' findings.'); return;
      }
      case 'side': sideTab = el.dataset.tab; render(); return;
      case 'decide': {
        const k = el.dataset.key, v = el.dataset.v;
        change(2, (j) => { j.decisions[k] = v; j.confirmed[k] = true; }); return;
      }
      case 'edit': ui.editing = id; ui.card = null; render(); return;
      case 'cancel-edit': ui.editing = null; render(); return;
      case 'save-edit': {
        const text = $('#editBox').value.toUpperCase().replace(/[—–]/g, '-').trim();
        ui.editing = null;
        change(2, (j) => setText(j, id, text)); return;
      }
      case 'revert': ui.editing = null; change(2, (j) => { delete j.overrides[id]; }); return;
      case 'show-gen': ui.showGen = ui.showGen === id ? null : id; render(); return;
      case 'remove':
        if (el.dataset.added === '1') change(2, (j) => { for (const k of Object.keys(j.added)) j.added[k] = j.added[k].filter((x) => x.id !== id); });
        else change(2, (j) => { j.removed[id] = true; });
        return;
      case 'putback': change(2, (j) => { delete j.removed[id]; }); return;
      case 'add-para': ui.addingTo = el.dataset.sec; render(); return;
      case 'cancel-add': ui.addingTo = null; render(); return;
      case 'save-add': {
        const text = $('#newPara').value.toUpperCase().trim();
        const sec = el.dataset.sec;
        ui.addingTo = null;
        if (!text) { render(); return; }
        change(2, (j) => { (j.added[sec] = j.added[sec] || []).push({ id: 'add.' + sec + '.' + Date.now().toString(36), text }); }); return;
      }
      case 'blank': ui.card = { id: el.dataset.id, i: Number(el.dataset.i), lit: 0 }; ui.editing = null; render(); return;
      case 'fill': fillBlank(id, el.dataset.key, $('#blankVal').value); return;
      case 'choose': applyBlank(id, (b) => b.options[Number(el.dataset.o)]); return;
      case 'keep-opt': applyBlank(id, () => ''); return;
      case 'del-opt': ui.card = null; change(2, (j) => { if (id.startsWith('add.')) { for (const k of Object.keys(j.added)) j.added[k] = j.added[k].filter((x) => x.id !== id); } else j.removed[id] = true; }); return;
      case 'goto': goto(el.dataset.ref); return;
      case 'cell': ui.cell = { key: el.dataset.key, f: el.dataset.f }; render(); return;
      case 'row-del': change(3, (j) => { if (el.dataset.key.startsWith('extra|')) j.extraPoints = j.extraPoints.filter((x) => 'extra|' + x.id !== el.dataset.key); else editRow(j, el.dataset.key, { removed: true }); }); return;
      case 'row-back': change(3, (j) => { editRow(j, el.dataset.key, { removed: false }); }); return;
      case 'row-revert': change(3, (j) => { delete j.pointEdits[el.dataset.key]; }); return;
      case 'add-point': ui.addPoint = true; render(); return;
      case 'cancel-point': ui.addPoint = false; render(); return;
      case 'save-point': {
        const x = { id: Date.now().toString(36), equipment: $('#apEq').value.toUpperCase(), desc: $('#apDesc').value.trim(), point: $('#apPoint').value, units: $('#apUnits').value.trim(), type: $('#apType').value.trim(), applies: $('#apApplies').value.trim() || 'Add as needed', section: $('#apSec').value, trend: $('#apTrend').checked, alarm: $('#apAlarm').checked };
        if (!x.desc) { toast('Type the point description.'); return; }
        ui.addPoint = false;
        change(3, (j) => { j.extraPoints.push(x); }); return;
      }
      case 'lib-yes': case 'lib-no': {
        const key = el.dataset.key;
        const m = E.libraryCheck(job, lib).find((x) => x.key === key) || null;
        change(4, (j) => {
          const prev = j.libAnswers[key];
          j.libAnswers[key] = a === 'lib-yes' ? 'yes' : 'no';
          j.extraPoints = j.extraPoints.filter((x) => x.libKey !== key);
          const ap = m ? m.point.applies.toLowerCase() : '';
          if (a === 'lib-yes' && m && m.type === E.TYPE_AHU && ap.includes('overflow')) { E.ahuUnits(j).forEach((u) => { u.condOverflow = true; }); return; }
          if (a === 'lib-yes' && m && m.type === E.TYPE_AHU && ap.includes('motorized oa damper')) { j.decisions.oaDamper = 'motorized'; j.confirmed.oaDamper = true; return; }
          if (a === 'lib-yes' && m && m.type === E.TYPE_GENERAL && /alarm contact/.test(ap)) { j.general.meterAlarm = true; return; }
          if (a === 'lib-yes' && m && m.type === E.TYPE_GENERAL && /meter tied/.test(ap)) { j.general.waterMeter = true; return; }
          if (a === 'lib-yes' && m && m.type !== E.TYPE_AHU && m.type !== E.TYPE_CU && m.type !== E.TYPE_GENERAL && !/^always/i.test(m.point.applies)) { j.units.filter((u) => u.type === m.type).forEach((u) => { u.conditions[m.point.applies] = true; }); return; }
          if (a === 'lib-yes' && m) {
            const tags = m.type === E.TYPE_CU ? E.ahuUnits(j).map((u) => u.cu) : m.type === E.TYPE_GENERAL ? ['BUILDING'] : j.units.filter((u) => u.type === m.type).map((u) => u.tag);
            j.extraPoints.push({ id: Date.now().toString(36), libKey: key, libDesc: m.point.desc, type: m.type, section: E.sectionOf(m.type), equipment: E.compressTags(tags.map((t) => String(t).toUpperCase())), desc: m.point.desc.toUpperCase(), point: m.point.point, units: m.point.units, trend: m.point.trend, alarm: m.point.alarm, applies: m.point.applies });
          }
          void prev;
        });
        return;
      }
      case 'issue': {
        const changes = $('#revChanges').value.trim();
        const rev = job.issued.length && !job.changedSinceIssue ? job.revision : nextRev(job.revision);
        const prev = JSON.stringify(job);
        job.revision = rev;
        job.issued.push({ rev, date: E.today(), changes: changes || (job.issued.length ? '' : 'First issue.') });
        job.changedSinceIssue = false;
        const ok = await saveFiles();
        if (!ok) { job = JSON.parse(prev); render(); return; }
        undo.push(prev); persist(); render(); return;
      }
      case 'save-files': saveFiles(); return;
      case 'copy-seq': {
        try { await navigator.clipboard.writeText($('#seqText').textContent); toast('✓ Copied.'); } catch (e) { toast('Select the text and copy it with Ctrl+C.'); }
        return;
      }
      case 'add-open': {
        const t = $('#newOpen').value.trim();
        if (t) change(5, (j) => { (j.openItems = j.openItems || []).push({ text: t, done: false }); });
        return;
      }
      default:
    }
  });

  function setText(j, id, text) {
    for (const k of Object.keys(j.added)) {
      const a = j.added[k].find((x) => x.id === id);
      if (a) { a.text = text; return; }
    }
    const gen = E.generateSequence(j);
    let base = null;
    gen.header.forEach((t, i) => { if ('hdr.' + i === id) base = t; });
    for (const s of gen.sections) for (const it of s.items) {
      if (it.id === id) base = it.text;
      for (const x of it.subs) if (x.id === id) base = x.text;
    }
    if (base === text) delete j.overrides[id];
    else j.overrides[id] = { text, base };
  }

  function currentText(id) {
    const seq = E.finalSequence(job);
    for (const s of seq.sections) for (const it of s.items) {
      if (it.id === id) return it.text;
      for (const x of it.subs) if (x.id === id) return x.text;
    }
    return null;
  }

  function fillBlank(id, key, v) {
    v = String(v || '').trim();
    if (!v) { toast('Type a value.'); return; }
    if (key) {
      if (isNaN(Number(v))) { toast('Type a number.'); return; }
      ui.card = null;
      change(2, (j) => { j.values[key] = Number(v); });
      toast('Filled in. It shows in Values too.');
      return;
    }
    applyBlank(id, () => v.toUpperCase());
  }

  function applyBlank(id, pick) {
    const text = currentText(id);
    if (text == null) return;
    const b = E.blanksIn(text)[ui.card ? ui.card.i : 0];
    if (!b) return;
    const rep = pick(b);
    let next = text.slice(0, b.start) + rep + text.slice(b.end);
    if (b.kind === 'optional') next = next.replace(/^\s+/, '');
    ui.card = E.blanksIn(next).length ? { id, i: 0, lit: 0 } : null;
    change(2, (j) => setText(j, id, next.replace(/\s{2,}/g, ' ').trim()));
  }

  function goto(ref) {
    const [kind, key] = ref.split(':');
    if (kind === 'decision') { sideTab = 'decisions'; render(); const d = document.getElementById('d-' + key); if (d) d.scrollIntoView({ block: 'center' }); return; }
    if (kind === 'item') {
      const text = currentText(key);
      const blanks = text ? E.blanksIn(text) : [];
      ui.card = blanks.length ? { id: key, i: 0, lit: 0 } : null;
      render();
      const p = document.getElementById('p-' + key);
      if (p) { p.scrollIntoView({ block: 'center' }); p.classList.add('flash'); }
    }
  }

  // keyboard: Ctrl+Z undo, Ctrl+S save, and the blank card keys
  document.addEventListener('keydown', (ev) => {
    const inBox = /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName);
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); saveJob(); return; }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z' && !inBox) { ev.preventDefault(); doUndo(); return; }
    if (ev.key === 'Enter' && ev.ctrlKey && ui.editing) { const b = $('[data-act="save-edit"]'); if (b) b.click(); return; }
    if (ev.key === 'Escape') {
      if (ui.card || ui.editing || ui.addingTo || ui.cell || ui.addPoint) { ui.card = null; ui.editing = null; ui.addingTo = null; ui.cell = null; ui.addPoint = false; render(); }
      return;
    }
    if (ui.cell && ev.key === 'Enter') { const t = $('[data-cell]'); if (t) saveCell(t); return; }
    if (!ui.card) return;
    const text = currentText(ui.card.id);
    const blanks = text ? E.blanksIn(text) : [];
    const b = blanks[ui.card.i];
    if (ev.key === 'Enter' && $('#blankVal') && document.activeElement === $('#blankVal')) { $('[data-act="fill"]').click(); return; }
    if (inBox) return;
    if (!b) return;
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
      ev.preventDefault();
      const all = allBlanks();
      const idx = all.findIndex((x) => x.id === ui.card.id && x.i === ui.card.i);
      const n = all[(idx + (ev.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length];
      if (n) { ui.card = { id: n.id, i: n.i, lit: 0 }; render(); const p = document.getElementById('p-' + n.id); if (p) p.scrollIntoView({ block: 'center' }); }
      return;
    }
    if (b.kind === 'choice') {
      if (ev.key === 'Tab' || ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); ui.card.lit = ((ui.card.lit || 0) + (ev.key === 'ArrowUp' ? -1 : 1) + b.options.length) % b.options.length; render(); return; }
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); applyBlank(ui.card.id, () => b.options[ui.card.lit || 0]); return; }
      const n = Number(ev.key);
      if (n >= 1 && n <= b.options.length) { applyBlank(ui.card.id, () => b.options[n - 1]); return; }
    }
    if (b.kind === 'optional') {
      if (ev.key.toLowerCase() === 'd') { const btn = $('[data-act="del-opt"]'); if (btn) btn.click(); return; }
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); applyBlank(ui.card.id, () => ''); }
    }
  });

  function allBlanks() {
    const out = [];
    const seq = E.finalSequence(job);
    for (const s of seq.sections) for (const it of s.items) {
      for (const x of [it, ...it.subs]) E.blanksIn(x.text).forEach((b, i) => out.push({ id: x.id, i }));
    }
    return out;
  }

  // file inputs
  $('#fileJob').addEventListener('change', (ev) => readFile(ev.target, (text) => {
    try {
      const j = JSON.parse(text);
      if (j.format !== 'soo-builder-job') throw new Error('not a job');
      undo.push(JSON.stringify(job));
      job = Object.assign(E.newJob(), j);
      fileHandle = null; stage = 1; persist(); render(); toast('✓ Job opened.');
    } catch (e) { toast('That file is not an SOO Builder job.'); }
  }));
  $('#fileLib').addEventListener('change', (ev) => readFile(ev.target, (text, name) => {
    try {
      const l = E.loadLibrary(text);
      if (!l.types.length) throw new Error('empty');
      lib = l; libName = name; store.set('soo.library', text); store.set('soo.libraryName', name); render();
      toast('✓ Library opened: ' + l.types.length + ' equipment types.');
    } catch (e) { toast('That file is not a points library CSV.'); }
  }));
  $('#fileDraft').addEventListener('change', (ev) => readFile(ev.target, (text) => { change(1, (j) => { j.draft = text; }); }));

  // start
  const ts = Number(store.get('soo.textSize'));
  if (ts) document.documentElement.style.fontSize = ts + 'px';
  const th = store.get('soo.theme');
  if (th) document.documentElement.dataset.theme = th;
  if (!unlocked(stage)) stage = 1;
  render();
  window.__soo = { get job() { return job; }, set job(j) { job = j; render(); }, render, E };
})();
