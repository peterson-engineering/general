// Acceptance tests from the build brief (Section 12) that run without Revit, AutoCAD or Excel.
// Run: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../app/engine.js');

const root = path.join(__dirname, '..');
const lib = E.loadLibrary(fs.readFileSync(path.join(root, 'library', 'master_points_library.csv'), 'utf8'));
const jobA = () => Object.assign(E.newJob(), JSON.parse(fs.readFileSync(path.join(root, 'examples', 'JOB-A.json'), 'utf8')));
const draft = fs.readFileSync(path.join(__dirname, 'fixtures', 'draft-appendix-c.txt'), 'utf8');
const seqText = (j) => E.sequenceText(E.finalSequence(j));
const rows = (j) => E.activeRows(E.pointRows(j, lib)).filter((r) => r.kind === 'point');

test('1. draft review flags the Appendix C findings', () => {
  const r = E.reviewDraft(draft, jobA());
  const has = (re) => assert.ok(r.some((x) => re.test(x.text)), 'missing: ' + re);
  has(/fixed supply air temperature/);
  has(/Electric heat is used as reheat/);
  has(/before the heat pump/);
  has(/One lockout value/);
  has(/stops the supply fan/);
  has(/ALL OF THE FOLLOWING/);
  has(/Dampers are told to close/);
  has(/modulating/);
  has(/not a section/);
  has(/several names/);
  has(/no dehumidification mode/);
  has(/emergency HVAC shutdown switch/);
  has(/hardwired and independent/);
  has(/Override duration/);
  has(/coil low limit/);
  has(/Alarms missing/);
  has(/outside airflow station/);
  has(/STOP\/STOP/);
  has(/BMS/);
  has(/TENANT/);
  has(/Minimum on\/off/);
});

test('1b. single-stage job: staging language is a conflict', () => {
  const j = jobA();
  j.units.forEach((u) => { if (u.compStages) { u.compStages = 1; u.heatStages = 1; } });
  assert.ok(E.reviewDraft(draft, j).some((x) => /every unit is scheduled single stage/.test(x.text)));
});

test('generated sequence matches the template text for the worked example', () => {
  const j = jobA();
  j.decisions.overrideTerm = 'LOCAL TENANT OVERRIDE';
  const ours = seqText(j);
  const tpl = fs.readFileSync(path.join(root, 'library', 'sequence_template_sz_cv_hp_ahu.txt'), 'utf8');
  // every numbered template line appears word for word, except the header lines the brief reformats
  const lines = tpl.split(/\r?\n/).map((l) => l.trim().replace(/^(\d+|[A-Z])\.\s+/, '')).filter((l) => l.length > 30 && !/SEQUENCE OF OPERATIONS$/.test(l));
  const missing = lines.filter((l) => !ours.includes(l));
  assert.deepStrictEqual(missing, []);
});

test('2. every point traces to the sequence and every sequence feature has its points', () => {
  const j = jobA();
  const checks = E.checkJob(j, lib).filter((c) => c.area === 'Cross-check');
  assert.deepStrictEqual(checks, []);
});

test('2b. a feature with no point is caught (OA flow station removed from the points list)', () => {
  const j = jobA();
  for (const r of rows(j)) if (/OUTSIDE AIRFLOW/.test(r.desc)) j.pointEdits[r.key] = { removed: true };
  assert.ok(E.checkJob(j, lib).some((c) => c.area === 'Cross-check' && /outside airflow/.test(c.text)));
});

test('2c. an unused sensor is caught (humidity sensor with monitor-only dehumidification keeps alarm text only)', () => {
  const j = jobA();
  j.decisions.dehum = 'monitor';
  const s = seqText(j);
  assert.ok(!/DEHUMIDIFICATION CONTROL/.test(s));
  assert.ok(E.checkJob(j, lib).some((c) => /Humid climate with no dehumidification control/.test(c.text)));
});

test('3. condensed sequence: alarms left to the points list are flagged on the list', () => {
  const j = jobA();
  const ok = E.checkJob(j, lib).filter((c) => c.area === 'Points list');
  assert.deepStrictEqual(ok, []);
  const sd = rows(j).find((r) => /SMOKE DETECTOR/.test(r.desc));
  j.pointEdits[sd.key] = { alarm: false };
  assert.ok(E.checkJob(j, lib).some((c) => c.area === 'Points list' && /SMOKE DETECTOR/.test(c.text)));
});

test('points list grouping: shared rows and per-unit rows', () => {
  const r = rows(jobA());
  const eq = r.map((x) => x.equipment).filter(Boolean);
  for (const t of ['AHU-1,2,3', 'AHU-2,3', 'AHU-3', 'CU-1,2,3', 'CU-3', 'BUILDING']) assert.ok(eq.includes(t), t);
  const ahu3 = r.slice(r.findIndex((x) => x.equipment === 'AHU-3')).slice(0, 3).map((x) => x.desc);
  assert.ok(ahu3.includes('ELECTRIC HEAT STAGE 2 COMMAND'));
  assert.ok(r.some((x) => x.desc === 'COMPRESSOR STAGE 2 STATUS'));
});

test('modulating hot gas reheat valve is an AO', () => {
  const j = jobA();
  j.decisions.hgrhValve = 'modulating';
  const v = rows(j).find((x) => /HOT GAS REHEAT VALVE COMMAND/.test(x.desc));
  assert.strictEqual(v.point, 'AO');
  assert.ok(/MODULATE THE HGRH VALVE/.test(seqText(j)));
});

test('4. Excel output: template layout, notes below the table, one page wide', () => {
  const x = Buffer.from(E.xlsx(E.pointRows(jobA(), lib))).toString('utf8');
  assert.ok(x.includes('Equipment Schedule Points List'));
  assert.ok(x.includes('<mergeCell ref="A1:F1"/>'));
  assert.ok(x.includes('fitToWidth="1"') && x.includes('fitToPage="1"'));
  assert.ok(x.includes('_xlnm.Print_Area'));
  assert.ok(x.indexOf('POINTS LIST NOTES:') > x.indexOf('GENERAL BUILDING SYSTEMS:'));
  for (const n of E.POINTS_NOTES) assert.ok(x.includes(n.replace(/'/g, "'").replace(/&/g, '&amp;')), n);
  for (const a of E.ABBREVIATIONS) assert.ok(x.includes(a));
  assert.ok(x.includes('style="medium"'));
});

test('Word output: numbered lists restart per section, lettered sub-items', () => {
  const d = Buffer.from(E.docx(E.finalSequence(jobA()))).toString('utf8');
  assert.ok(d.includes('word/numbering.xml'));
  assert.ok(d.includes('w:numFmt w:val="upperLetter"'));
  assert.ok(d.includes('<w:numId w:val="12"/>'));
});

test('6. library check lists missing points; update adds new points with the job code', () => {
  const j = jobA();
  const miss = E.libraryCheck(j, lib);
  assert.ok(miss.some((m) => /Condensate pan high level/.test(m.point.desc)));
  assert.ok(!miss.some((m) => /Zone temp$/.test(m.point.desc)));
  j.extraPoints.push({ id: 'x1', type: 'Exhaust fans', desc: 'Fan VFD fault', point: 'DI', units: 'OK/FAULT', trend: true, alarm: true, section: 'HVAC' });
  j.extraPoints.push({ id: 'x2', type: 'Kitchen hood', desc: 'Hood fan status', point: 'DI', units: 'ON/OFF', trend: true, alarm: false, section: 'HVAC' });
  const u = E.libraryUpdate(j, lib);
  assert.strictEqual(u.added.length, 2);
  const csv = E.libraryToCSV(u.lib);
  assert.ok(csv.includes('Exhaust fans,Fan VFD fault,DI,OK/FAULT,X,X,Add as needed,JOB-A'));
  assert.ok(csv.includes('Kitchen hood,Hood fan status'));
  assert.strictEqual(E.loadLibrary(csv).types.length, lib.types.length + 1);
  // never deletes points
  assert.ok(E.loadLibrary(csv).types.reduce((a, t) => a + t.points.length, 0) === lib.types.reduce((a, t) => a + t.points.length, 0) + 2);
});

test('7. no output contains a long dash, "BMS" or BI/BO', () => {
  const j = jobA();
  for (const f of E.outputs(j, lib)) {
    if (/\.csv$/.test(f.name)) continue;
    const t = Buffer.from(f.data).toString('utf8');
    assert.ok(!/[—–]/.test(t), f.name + ' has a long dash');
    assert.ok(!/\bBMS\b/.test(t), f.name + ' has BMS');
    assert.ok(!/>B[IO]</.test(t) && !/ \| B[IO] \|/.test(t), f.name + ' has BI/BO');
  }
});

test('blank lockouts print as [TBD] and are flagged to fix', () => {
  const j = jobA();
  j.values = {};
  assert.ok(/\[TBD: COOLING LOW-AMBIENT LOCKOUT/.test(seqText(j)));
  assert.ok(E.checkJob(j, lib).some((c) => c.level === 'fix' && /lockout/.test(c.text)));
});

test('engineering checks: electric reheat over 80 MBH, return detector over 2,000 CFM', () => {
  const j = jobA();
  j.decisions.reheat = 'electric';
  j.units[2].returnSd = false;
  const t = E.engineeringChecks(j).map((e) => e.text).join('\n');
  assert.ok(/AHU-3 \(130 MBH\)/.test(t));
  assert.ok(/IMC 2,000 CFM/.test(t));
});

test('engineer wording survives regeneration and is flagged when the template changes under it', () => {
  const j = jobA();
  j.overrides['occ.2'] = { text: 'MY OWN SETPOINT WORDING.', base: E.generateSequence(j).sections.find((s) => s.key === 'occ').items[1].text };
  assert.ok(seqText(j).includes('MY OWN SETPOINT WORDING.'));
  j.values.OCC_CLG = 74;
  const it = E.finalSequence(j).sections.find((s) => s.key === 'occ').items[1];
  assert.ok(it.stale);
});
