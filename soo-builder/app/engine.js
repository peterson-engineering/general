/*
 * SOO and DDC Points List Builder: shared engine.
 * Used by the editor page (app/index.html) and by the command line builder (cli/build.mjs).
 * No dependencies. Works in a browser (window.SooEngine) and in Node (require).
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- basics

  const TYPE_AHU = 'Single-zone CV split heat pump AHU (HGRH, electric aux heat)';
  const TYPE_CU = 'Split heat pump condensing unit (paired with item 1)';
  const TYPE_GENERAL = 'General building systems';
  const SECTION_ORDER = ['HVAC', 'PLUMBING', 'GENERAL'];
  const SECTION_TITLE = { HVAC: 'HVAC SYSTEMS:', PLUMBING: 'PLUMBING SYSTEMS:', GENERAL: 'GENERAL BUILDING SYSTEMS:' };

  function sectionOf(typeName) {
    const t = (typeName || '').toLowerCase();
    if (t.startsWith('plumbing')) return 'PLUMBING';
    if (t.startsWith('general building')) return 'GENERAL';
    return 'HVAC';
  }

  const up = (s) => String(s == null ? '' : s).toUpperCase();
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const today = () => new Date().toISOString().slice(0, 10);

  // ---------------------------------------------------------------- CSV

  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', q = false;
    text = String(text || '').replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
        } else field += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some((f) => f !== '')) rows.push(row);
        row = [];
      } else field += c;
    }
    row.push(field);
    if (row.some((f) => f !== '')) rows.push(row);
    return rows;
  }

  function toCSV(rows) {
    return rows.map((r) => r.map((f) => {
      const s = String(f == null ? '' : f);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\r\n') + '\r\n';
  }

  // ---------------------------------------------------------------- library

  const LIB_HEADER = ['equipment_type', 'point_description', 'point', 'units', 'trend', 'alarm', 'applies_when', 'source'];

  function loadLibrary(csvText) {
    const rows = parseCSV(csvText);
    const head = rows.shift().map((h) => h.trim().toLowerCase());
    const col = (n) => head.indexOf(n);
    const types = [];
    const byName = {};
    for (const r of rows) {
      const name = (r[col('equipment_type')] || '').trim();
      if (!name) continue;
      if (!byName[name]) {
        byName[name] = { name, section: sectionOf(name), points: [] };
        types.push(byName[name]);
      }
      byName[name].points.push({
        desc: (r[col('point_description')] || '').trim(),
        point: (r[col('point')] || '').trim(),
        units: (r[col('units')] || '').trim(),
        trend: /x/i.test(r[col('trend')] || ''),
        alarm: /x/i.test(r[col('alarm')] || ''),
        applies: (r[col('applies_when')] || '').trim(),
        source: (r[col('source')] || '').trim(),
      });
    }
    return { types, byName };
  }

  function libraryToCSV(lib) {
    const rows = [LIB_HEADER];
    for (const t of lib.types) {
      for (const p of t.points) rows.push([t.name, p.desc, p.point, p.units, p.trend ? 'X' : '', p.alarm ? 'X' : '', p.applies, p.source]);
    }
    return toCSV(rows);
  }

  /** Conditions a unit of a generic type can switch on (distinct "Applies when" values, not "Always"). */
  function conditionsFor(lib, typeName) {
    const t = lib.byName[typeName];
    if (!t) return [];
    const seen = [];
    for (const p of t.points) if (!/^always/i.test(p.applies) && !seen.includes(p.applies)) seen.push(p.applies);
    return seen;
  }

  // ---------------------------------------------------------------- job model

  const DECISIONS = [
    {
      key: 'dehum', title: 'Dehumidification',
      ask: 'How should the units dehumidify?',
      options: [
        { value: 'full', label: 'Full mode with reheat', hint: 'Compressor runs on return humidity, reheat holds the zone between setpoints.' },
        { value: 'compressor', label: 'Compressor only with zone low limit', hint: 'No reheat. Dehumidification stops if the zone gets cold.' },
        { value: 'monitor', label: 'Monitor and alarm only', hint: 'Humidity is trended and alarmed. No control.' },
      ],
      recommend: () => 'full',
    },
    {
      key: 'reheat', title: 'Reheat source',
      ask: 'What reheats the air during dehumidification?',
      options: [
        { value: 'hgrh', label: 'Hot gas reheat', hint: 'Recovered heat. Meets the ASHRAE 90.1 reheat exception.' },
        { value: 'electric', label: 'Electric reheat', hint: 'New energy reheat. Limited by ASHRAE 90.1 6.5.2.3 on larger units.' },
      ],
      when: (j) => j.decisions.dehum === 'full',
      recommend: () => 'hgrh',
    },
    {
      key: 'hgrhValve', title: 'Hot gas reheat valve',
      ask: 'Is the hot gas reheat valve on/off or modulating?',
      options: [
        { value: 'onoff', label: 'On/off', hint: 'Points list: HGRH command DO.' },
        { value: 'modulating', label: 'Modulating', hint: 'Points list: HGRH valve command AO, %.' },
      ],
      when: (j) => usesHgrh(j),
      recommend: () => 'onoff',
    },
    {
      key: 'oaDamper', title: 'Outside air damper',
      ask: 'How is outside air set at the units?',
      options: [
        { value: 'mvd', label: 'Manual volume damper only', hint: 'Set during test and balance. No "dampers shall close" language.' },
        { value: 'motorized', label: 'Add a two-position motorized damper', hint: 'Opens with the fan in occupied mode, closes otherwise.' },
      ],
      recommend: () => 'mvd',
    },
    {
      key: 'esds', title: 'Emergency HVAC shutdown switch',
      ask: 'Is there an emergency HVAC shutdown switch, and how does it stop the units?',
      options: [
        { value: 'hardwired', label: 'Hardwired, BAS monitors only', hint: 'Stops the fan, compressor, reheat and electric heat without the BAS.' },
        { value: 'programmed', label: 'Programmed through the BAS', hint: 'The BAS stops the units. Check the notes sheet says the same.' },
        { value: 'none', label: 'No switch on this job', hint: '' },
      ],
      recommend: (j) => (j.government ? 'hardwired' : 'none'),
    },
    {
      key: 'overrideTerm', title: 'Override wording',
      ask: 'What should the zone sensor override be called?',
      options: [
        { value: 'LOCAL OVERRIDE', label: 'Local override', hint: 'Suits government and military jobs.' },
        { value: 'LOCAL TENANT OVERRIDE', label: 'Local tenant override', hint: 'Commercial wording.' },
      ],
      when: (j) => ahuUnits(j).some((u) => u.override),
      recommend: (j) => (j.government ? 'LOCAL OVERRIDE' : 'LOCAL TENANT OVERRIDE'),
    },
  ];

  /** Every setpoint, limit and delay the sequence uses. kind sets the wording; blank values print as a [TBD] blank. */
  const VALUES = [
    { key: 'OCC_CLG', label: 'Occupied cooling setpoint', kind: 'F', def: 75, group: 'Setpoints' },
    { key: 'OCC_HTG', label: 'Occupied heating setpoint', kind: 'F', def: 68, group: 'Setpoints' },
    { key: 'DEADBAND', label: 'Minimum deadband', kind: 'F', def: 2, group: 'Setpoints' },
    { key: 'UNOCC_CLG', label: 'Unoccupied cooling setpoint', kind: 'F', def: 80, group: 'Setpoints' },
    { key: 'UNOCC_HTG', label: 'Unoccupied heating setpoint', kind: 'F', def: 65, group: 'Setpoints' },
    { key: 'UNOCC_BAND', label: 'Unoccupied recovery band (inside setpoint)', kind: 'F', def: 2, group: 'Setpoints' },
    { key: 'OVERRIDE_HRS', label: 'Override duration', kind: 'hr', def: 2, group: 'Setpoints' },
    { key: 'COMP_DIFF', label: 'Compressor on/off differential', kind: 'F', def: 1, group: 'Compressor' },
    { key: 'STAGE_DT', label: 'Staging trigger, distance from setpoint', kind: 'F', def: 1.5, group: 'Compressor' },
    { key: 'STAGE_MIN', label: 'Staging trigger, time', kind: 'min', def: 10, group: 'Compressor' },
    { key: 'COMP_ISD', label: 'Compressor interstage delay', kind: 'min', def: 3, group: 'Compressor' },
    { key: 'COMP_MIN_ON', label: 'Compressor minimum on time', kind: 'min', def: 3, group: 'Compressor' },
    { key: 'COMP_MIN_OFF', label: 'Compressor minimum off time', kind: 'min', def: 5, group: 'Compressor' },
    { key: 'CHANGEOVER', label: 'Cooling / heating changeover delay', kind: 'min', def: 5, group: 'Compressor' },
    { key: 'LL_OFF', label: 'Coil low limit, stage off below', kind: 'F', def: 45, group: 'Compressor' },
    { key: 'LL_ON', label: 'Coil low limit, stage back on above', kind: 'F', def: 50, group: 'Compressor' },
    { key: 'CLG_LOCKOUT', label: 'Cooling low-ambient lockout (OA temp)', kind: 'F', def: null, group: 'Lockouts', ask: true },
    { key: 'HP_LOCKOUT', label: 'Heat pump heating lockout (OA temp)', kind: 'F', def: null, group: 'Lockouts', ask: true },
    { key: 'EH_ISD', label: 'Electric heat interstage delay', kind: 'min', def: 1, group: 'Electric heat' },
    { key: 'EH_AUX_DT', label: 'Aux heat enable, distance below heating setpoint', kind: 'F', def: 1.5, group: 'Electric heat' },
    { key: 'EH_AUX_MIN', label: 'Aux heat enable, time', kind: 'min', def: 10, group: 'Electric heat' },
    { key: 'EH_OFF', label: 'Electric heat off, within heating setpoint', kind: 'F', def: 0.5, group: 'Electric heat' },
    { key: 'DAT_HIGH', label: 'Discharge air high limit', kind: 'F', def: 95, group: 'Electric heat' },
    { key: 'PURGE_SEC', label: 'Electric heat purge', kind: 'secAdj', def: 60, group: 'Electric heat' },
    { key: 'OCC_RH_ON', label: 'Occupied dehumidification on above', kind: 'RH', def: 60, group: 'Humidity' },
    { key: 'OCC_RH_OFF', label: 'Occupied dehumidification off below', kind: 'RH', def: 55, group: 'Humidity' },
    { key: 'UNOCC_RH_ON', label: 'Unoccupied dehumidification on above', kind: 'RH', def: 65, group: 'Humidity' },
    { key: 'UNOCC_RH_OFF', label: 'Unoccupied dehumidification off below', kind: 'RH', def: 60, group: 'Humidity' },
    { key: 'PROOF_SEC', label: 'Fan proof of flow timeout', kind: 'sec', def: 60, group: 'Alarms' },
    { key: 'ZT_ALARM_DT', label: 'Zone temp alarm, distance from setpoint', kind: 'F', def: 5, group: 'Alarms' },
    { key: 'ZT_ALARM_MIN', label: 'Zone temp alarm, time', kind: 'min', def: 15, group: 'Alarms' },
    { key: 'RH_ALARM', label: 'High humidity alarm above', kind: 'RH', def: 65, group: 'Alarms' },
    { key: 'RH_ALARM_MIN', label: 'High humidity alarm, time', kind: 'min', def: 60, group: 'Alarms' },
    { key: 'OA_ALARM_PCT', label: 'Low outside airflow alarm, below design', kind: 'pct', def: 20, group: 'Alarms' },
    { key: 'OA_ALARM_MIN', label: 'Low outside airflow alarm, time', kind: 'min', def: 15, group: 'Alarms' },
    { key: 'DAMPER_SEC', label: 'Emergency damper alarm, not closed within', kind: 'sec', def: 60, group: 'Alarms' },
  ];
  const VALUE_BY_KEY = Object.fromEntries(VALUES.map((v) => [v.key, v]));

  function newJob() {
    return {
      format: 'soo-builder-job', version: 1,
      code: '', title: '', government: true, humid: true,
      revision: '', issued: [], changedSinceIssue: false,
      decisions: {}, confirmed: {}, values: {},
      units: [], general: { oat: true, esdsDampers: ['OUTSIDE AIR INTAKE LOUVER', 'EXHAUST LOUVER'], waterMeter: false, meterAlarm: false },
      draft: '', review: [], reviewNotes: {},
      overrides: {}, added: {}, removed: {},
      pointEdits: {}, extraPoints: [], libAnswers: {},
      signoff: {}, openItems: [], log: [],
    };
  }

  function newAhu(n) {
    return {
      id: 'u' + Math.random().toString(36).slice(2, 9), type: TYPE_AHU,
      tag: 'AHU-' + n, cu: 'CU-' + n, compStages: 1, heatStages: 1,
      cfm: '', oaCfm: '', coolingMbh: '',
      rat: true, rh: true, override: true, oaFlow: true, highStatic: true,
      supplySd: false, returnSd: false, condOverflow: false,
    };
  }

  function newUnit(typeName, tag) {
    return { id: 'u' + Math.random().toString(36).slice(2, 9), type: typeName, tag: tag || '', conditions: {} };
  }

  const ahuUnits = (j) => j.units.filter((u) => u.type === TYPE_AHU);
  const decision = (j, key) => {
    if (j.decisions[key] != null) return j.decisions[key];
    const d = DECISIONS.find((x) => x.key === key);
    return d ? d.recommend(j) : undefined;
  };
  const dehumMode = (j) => decision(j, 'dehum');
  const dehumActive = (j) => ['full', 'compressor'].includes(dehumMode(j)) && ahuUnits(j).some((u) => u.rh);
  const reheatSource = (j) => (dehumMode(j) === 'full' ? decision(j, 'reheat') : 'none');
  function usesHgrh(j) { return dehumActive(j) && reheatSource(j) === 'hgrh'; }
  const esdsMode = (j) => decision(j, 'esds');
  const hasEsds = (j) => esdsMode(j) !== 'none';

  /** Decisions that apply to this job and have not been confirmed by the engineer. */
  function openDecisions(j) {
    return DECISIONS.filter((d) => (!d.when || d.when(j)) && !j.confirmed[d.key]);
  }

  function value(j, key) {
    const v = j.values[key];
    if (v !== undefined && v !== null && v !== '') return v;
    return VALUE_BY_KEY[key].def;
  }

  function fmtValue(j, key) {
    const meta = VALUE_BY_KEY[key];
    const v = value(j, key);
    if (v === null || v === undefined || v === '') return '[TBD: ' + up(meta.label) + ']';
    const n = Number(v);
    switch (meta.kind) {
      case 'F': return v + '°F (ADJ.)';
      case 'RH': return v + '% RH (ADJ.)';
      case 'pct': return v + '% (ADJ.)';
      case 'min': return v + (n === 1 ? ' MINUTE' : ' MINUTES') + ' (ADJ.)';
      case 'hr': return v + (n === 1 ? ' HOUR' : ' HOURS') + ' (ADJ.)';
      case 'sec': return v + (n === 1 ? ' SECOND' : ' SECONDS') + ' (ADJ.)';
      case 'secAdj': return v + '-SECOND (ADJ.)';
      default: return v + ' (ADJ.)';
    }
  }

  // ---------------------------------------------------------------- words

  function joinAnd(list) {
    list = list.filter(Boolean);
    if (list.length <= 1) return list.join('');
    if (list.length === 2) return list[0] + ' AND ' + list[1];
    return list.slice(0, -1).join(', ') + ', AND ' + list[list.length - 1];
  }

  const STAGE_WORD = ['NO', 'SINGLE-STAGE', 'TWO-STAGE', 'THREE-STAGE', 'FOUR-STAGE'];
  const stageWord = (n) => STAGE_WORD[n] || n + '-STAGE';

  /** "AHU-1", "AHU-2", "AHU-3" -> "AHU-1,2,3" for the points list. */
  function compressTags(tags) {
    const out = [];
    let prefix = null, nums = [];
    const flush = () => { if (prefix !== null) out.push(prefix + nums.join(',')); prefix = null; nums = []; };
    for (const t of tags) {
      const m = /^(.*?)(\d+[A-Z]?)$/i.exec(t);
      if (m && m[1] && m[1] === prefix) nums.push(m[2]);
      else { flush(); if (m && m[1]) { prefix = m[1]; nums = [m[2]]; } else out.push(t); }
    }
    flush();
    return out.join(', ');
  }

  // ---------------------------------------------------------------- sequence

  /**
   * Builds the single-zone CV split heat pump AHU sequence from the units, decisions and values.
   * Each item has a stable id so the engineer's own wording (overrides) survives regeneration.
   */
  function generateSequence(j) {
    const units = ahuUnits(j);
    if (!units.length) return { header: [], sections: [] };
    const tags = units.map((u) => up(u.tag));
    const all = (f) => units.every(f);
    const any = (f) => units.some(f);
    const which = (f) => { // '' if every unit, ' (AHU-2 AND AHU-3)' if some, null if none
      const t = units.filter(f).map((u) => up(u.tag));
      if (!t.length) return null;
      return t.length === units.length ? '' : ' (' + joinAnd(t) + ')';
    };
    const V = (k) => fmtValue(j, k);
    const eh = any((u) => Number(u.heatStages) > 0);
    const hgrh = usesHgrh(j);
    const reheat = reheatSource(j);
    const dehum = dehumActive(j);
    const dMode = dehumMode(j);
    const motorized = decision(j, 'oaDamper') === 'motorized';
    const esds = hasEsds(j);
    const esdsHard = esdsMode(j) === 'hardwired';
    const term = decision(j, 'overrideTerm');
    const anySd = any((u) => u.supplySd || u.returnSd);
    const anyHs = any((u) => u.highStatic);
    const multi = units.filter((u) => Number(u.compStages) > 1 || Number(u.heatStages) > 1);
    const single = units.filter((u) => !(Number(u.compStages) > 1 || Number(u.heatStages) > 1));
    const maxStages = Math.max(...units.map((u) => Math.max(Number(u.compStages) || 0, Number(u.heatStages) || 0)));
    const reheatName = hgrh ? 'HGRH' : (reheat === 'electric' ? 'ELECTRIC REHEAT' : null);
    const energized = joinAnd(['THE COMPRESSOR', hgrh ? 'HGRH' : null, eh ? 'ELECTRIC HEAT' : null]);

    const S = [];
    const sec = (key, title) => { const s = { key, title, items: [] }; S.push(s); return s; };
    const item = (s, id, text, subs) => { s.items.push({ id: s.key + '.' + id, text, subs: (subs || []).map((t, i) => ({ id: s.key + '.' + id + '.' + String.fromCharCode(97 + i), text: t })) }); };

    const header = [
      'AHU CV - HEAT PUMP' + (hgrh || eh ? ' WITH ' + joinAnd([hgrh ? 'HOT GAS REHEAT' : null, eh ? 'ELECTRIC AUX. HEAT' : null]) : '') + ' - SINGLE ZONE - SEQUENCE OF OPERATIONS',
      'TYPICAL FOR ' + tags.join(', '),
    ];

    // GENERAL
    let s = sec('gen', 'GENERAL');
    item(s, 'desc', 'THIS SEQUENCE APPLIES TO A CONSTANT VOLUME (CV), SINGLE-ZONE AIR HANDLING UNIT (AHU) SERVING ONE THERMAL ZONE. THE AHU IS PAIRED WITH A SPLIT-SYSTEM HEAT PUMP CONDENSING UNIT (CU) PROVIDING '
      + (hgrh ? 'DIRECT EXPANSION (DX) COOLING, HEAT PUMP HEATING, AND HOT GAS REHEAT (HGRH). THE HGRH COIL IS LOCATED DOWNSTREAM OF THE DX/HP COIL.' : 'DIRECT EXPANSION (DX) COOLING AND HEAT PUMP HEATING.')
      + (eh ? ' AUXILIARY ELECTRIC HEAT IS PROVIDED BY A CONTACTOR-STAGED ELECTRIC HEATER LOCATED DOWNSTREAM OF THE SUPPLY FAN.' : ''));
    const stageGroups = [];
    for (const u of units) {
      const k = (Number(u.compStages) || 0) + '/' + (Number(u.heatStages) || 0);
      let g = stageGroups.find((x) => x.k === k);
      if (!g) { g = { k, c: Number(u.compStages) || 0, h: Number(u.heatStages) || 0, tags: [] }; stageGroups.push(g); }
      g.tags.push(up(u.tag));
    }
    item(s, 'stages', stageGroups.map((g) => joinAnd(g.tags) + ': ' + stageWord(g.c) + ' COMPRESSOR AND ' + (g.h ? stageWord(g.h) + ' ELECTRIC HEAT' : 'NO ELECTRIC HEAT') + '.').join(' '));
    if (multi.length) {
      const anyMultiC = units.some((u) => Number(u.compStages) > 1);
      const anyMultiH = units.some((u) => Number(u.heatStages) > 1);
      const isd = joinAnd([anyMultiC ? V('COMP_ISD') + ' FOR COMPRESSORS' : null, anyMultiH ? V('EH_ISD') + ' FOR ELECTRIC HEAT' : null]);
      item(s, 'staging', 'STAGING (' + joinAnd(multi.map((u) => up(u.tag))) + '): STAGE 1 SHALL ENERGIZE ON A CALL. '
        + (maxStages > 2 ? 'EACH ADDITIONAL STAGE' : 'STAGE 2') + ' SHALL ENERGIZE WHEN THE CONTROLLED VARIABLE REMAINS ' + V('STAGE_DT') + ' FROM SETPOINT'
        + (dehum ? ' (OR ABOVE HUMIDITY SETPOINT)' : '') + ' FOR ' + V('STAGE_MIN') + ' WITH ' + (maxStages > 2 ? 'THE PREVIOUS STAGE' : 'STAGE 1') + ' RUNNING. STAGES SHALL DE-ENERGIZE IN REVERSE ORDER. INTERSTAGE DELAY SHALL BE ' + isd + '.'
        + (single.length ? ' ' + joinAnd(single.map((u) => up(u.tag))) + ' SHALL CYCLE THE SINGLE STAGE.' : ''));
    } else {
      item(s, 'staging', 'EACH UNIT SHALL CYCLE ITS SINGLE COMPRESSOR STAGE' + (eh ? ' AND SINGLE ELECTRIC HEAT STAGE' : '') + ' ON A CALL.');
    }
    const oaFlowW = which((u) => u.oaFlow);
    item(s, 'oa', (motorized
      ? 'A TWO-POSITION MOTORIZED OUTSIDE AIR DAMPER SHALL OPEN WHEN THE SUPPLY FAN RUNS IN OCCUPIED MODE AND SHALL CLOSE WHEN THE SUPPLY FAN STOPS AND IN UNOCCUPIED MODE. THE OUTSIDE AIR QUANTITY IS SET DURING TEST AND BALANCE.'
      : 'OUTSIDE AIR IS SET BY A MANUAL VOLUME DAMPER (MVD), SET DURING TEST AND BALANCE. OUTSIDE AIR IS INTRODUCED WHENEVER THE SUPPLY FAN RUNS.')
      + (oaFlowW !== null ? ' AN OUTSIDE AIRFLOW MEASURING STATION IS PROVIDED' + oaFlowW + ' FOR MONITORING ONLY.' : ''));
    item(s, 'defrost', 'DEFROST SHALL BE CONTROLLED BY THE CU FACTORY CONTROLLER.');
    if (anySd) {
      const sdText = (u) => (u.supplySd && u.returnSd ? 'SUPPLY AND RETURN' : u.supplySd ? 'SUPPLY' : u.returnSd ? 'RETURN' : 'NONE');
      const groups = [];
      for (const u of units) { const t = sdText(u); let g = groups.find((x) => x.t === t); if (!g) { g = { t, tags: [] }; groups.push(g); } g.tags.push(up(u.tag)); }
      item(s, 'sd', 'DUCT SMOKE DETECTORS: ' + (groups.length === 1 ? groups[0].t + ', EACH UNIT.' : groups.map((g) => joinAnd(g.tags) + ': ' + g.t + '.').join(' ')));
    }
    const rhW = which((u) => u.rh);
    if (dehum && rhW) item(s, 'rhunits', 'DEHUMIDIFICATION CONTROL APPLIES ONLY TO UNITS WITH A RETURN AIR HUMIDITY SENSOR' + rhW + '.');

    // CONTROL SYSTEM
    s = sec('ctl', 'CONTROL SYSTEM');
    item(s, '1', 'THE UNIT SHALL BE CONTROLLED BY THE BUILDING AUTOMATION SYSTEM (BAS) THROUGH A DEDICATED DIRECT DIGITAL CONTROL (DDC) CONTROLLER INTERFACING WITH THE CU FACTORY-PACKAGED CONTROLLER.');
    item(s, '2', 'THE BAS SHALL MONITOR AND TREND ALL POINTS LISTED ON THE DDC POINTS LIST.');
    item(s, '3', 'ALL SETPOINTS AND TIME DELAYS LISTED HEREIN ARE ADJUSTABLE (ADJ.) THROUGH THE BAS UNLESS NOTED OTHERWISE.');

    // OPERATING MODES
    const ovW = which((u) => u.override);
    s = sec('modes', 'OPERATING MODES');
    item(s, '1', 'THE UNIT SHALL OPERATE IN OCCUPIED MODE OR UNOCCUPIED MODE AS DETERMINED BY THE BAS SCHEDULE' + (ovW !== null ? ' OR ' + term : '') + '. WITHIN EACH MODE THE UNIT SHALL OPERATE IN COOLING, HEATING, ' + (dehum ? 'DEHUMIDIFICATION, ' : '') + 'OR FAN ONLY.');
    if (ovW !== null) item(s, 'override', term + ovW + ' SHALL PLACE THE UNIT IN OCCUPIED MODE FOR ' + V('OVERRIDE_HRS') + ', THEN RETURN TO SCHEDULE.');
    item(s, 'changeover', 'COOLING AND HEAT PUMP HEATING SHALL NOT OPERATE AT THE SAME TIME. A CHANGEOVER DELAY OF ' + V('CHANGEOVER') + ' SHALL BE ENFORCED BETWEEN COOLING AND HEATING.');

    // STARTUP
    s = sec('start', 'STARTUP SEQUENCE');
    const lockouts = [anySd ? 'SMOKE DETECTOR' : null, anyHs ? 'HIGH STATIC' : null, eh ? 'ELECTRIC HEATER HIGH-LIMIT' : null, esds ? 'EMERGENCY HVAC SHUTDOWN' : null].filter(Boolean);
    item(s, '1', 'UPON A CALL TO ENTER OCCUPIED MODE, THE BAS SHALL VERIFY NO ACTIVE UNIT LOCKOUTS' + (lockouts.length ? ' (' + lockouts.join(', ') + ')' : '') + ' EXIST. A COMPRESSOR FAULT OR OUTSIDE AIR TEMPERATURE LOCKOUT SHALL BLOCK THE AFFECTED FUNCTION ONLY AND SHALL NOT PREVENT THE SUPPLY FAN FROM STARTING.');
    item(s, '2', (motorized ? 'THE OUTSIDE AIR DAMPER SHALL OPEN. UPON PROOF OF THE DAMPER END SWITCH, THE SUPPLY FAN SHALL START.' : 'THE SUPPLY FAN SHALL START.')
      + ' UPON PROOF OF AIRFLOW, THE BAS SHALL ENABLE ' + joinAnd(['COMPRESSOR', hgrh ? 'HGRH' : null, eh ? 'ELECTRIC HEAT' : null]) + ' CONTROL.');
    item(s, '3', 'IF PROOF OF AIRFLOW IS NOT ESTABLISHED WITHIN ' + V('PROOF_SEC') + ' OF THE FAN START COMMAND, THE BAS SHALL SHUT DOWN THE UNIT AND GENERATE A SUPPLY FAN FAILURE ALARM.');

    // OCCUPIED MODE
    s = sec('occ', 'OCCUPIED MODE');
    item(s, '1', 'THE SUPPLY FAN SHALL RUN CONTINUOUSLY.');
    item(s, '2', 'OCCUPIED COOLING SETPOINT SHALL BE ' + V('OCC_CLG') + '. OCCUPIED HEATING SETPOINT SHALL BE ' + V('OCC_HTG') + '. THE BAS SHALL ENFORCE A MINIMUM DEADBAND OF ' + V('DEADBAND') + ' BETWEEN SETPOINTS.');
    item(s, '3', 'WHEN ZONE TEMPERATURE IS BETWEEN SETPOINTS' + (dehum ? ' AND NO DEHUMIDIFICATION CALL EXISTS' : '') + ', THE UNIT SHALL OPERATE IN FAN ONLY.');

    // COMPRESSOR CONTROL
    s = sec('comp', 'COMPRESSOR CONTROL');
    item(s, 'cool', 'COOLING: ON A RISE IN ZONE TEMPERATURE ABOVE THE ACTIVE COOLING SETPOINT, THE BAS SHALL POSITION THE REVERSING VALVE TO COOLING AND STAGE THE COMPRESSOR. THE COMPRESSOR SHALL DE-ENERGIZE WHEN ZONE TEMPERATURE FALLS ' + V('COMP_DIFF') + ' BELOW THE COOLING SETPOINT.');
    item(s, 'heat', 'HEATING: ON A DROP IN ZONE TEMPERATURE BELOW THE ACTIVE HEATING SETPOINT, THE BAS SHALL POSITION THE REVERSING VALVE TO HEATING AND STAGE THE COMPRESSOR. THE COMPRESSOR SHALL DE-ENERGIZE WHEN ZONE TEMPERATURE RISES ' + V('COMP_DIFF') + ' ABOVE THE HEATING SETPOINT. THE HEAT PUMP SHALL BE THE PRIMARY HEATING SOURCE.');
    item(s, 'min', 'MINIMUM COMPRESSOR ON-TIME SHALL BE ' + V('COMP_MIN_ON') + '. MINIMUM COMPRESSOR OFF-TIME SHALL BE ' + V('COMP_MIN_OFF') + '.');
    item(s, 'lowlimit', 'COIL LOW LIMIT (COOLING' + (dehum ? ' AND DEHUMIDIFICATION' : '') + ' ONLY): IF DX/HP COIL LEAVING AIR TEMPERATURE FALLS BELOW ' + V('LL_OFF') + ', THE BAS SHALL DE-ENERGIZE ONE COMPRESSOR STAGE UNTIL LEAVING AIR TEMPERATURE RISES ABOVE ' + V('LL_ON') + '.');
    item(s, 'lockouts', 'LOCKOUTS: COOLING SHALL BE LOCKED OUT BELOW A LOW-AMBIENT SETPOINT OF ' + V('CLG_LOCKOUT') + ' OUTSIDE AIR TEMPERATURE. HEAT PUMP HEATING SHALL BE LOCKED OUT BELOW ' + V('HP_LOCKOUT') + ' OUTSIDE AIR TEMPERATURE OR UPON A COMPRESSOR FAULT. LOCKOUTS SHALL BE LOGGED AS EVENTS, NOT ALARMS.');

    // AUXILIARY ELECTRIC HEAT
    if (eh) {
      s = sec('aux', 'AUXILIARY ELECTRIC HEAT CONTROL');
      item(s, '1', reheat === 'electric' && dehum
        ? 'THE ELECTRIC HEATER SHALL OPERATE AS AUXILIARY HEAT AND AS DEHUMIDIFICATION REHEAT AS DESCRIBED UNDER DEHUMIDIFICATION CONTROL.'
        : 'THE ELECTRIC HEATER SHALL OPERATE AS AUXILIARY HEAT ONLY AND SHALL NOT BE USED FOR DEHUMIDIFICATION REHEAT.');
      item(s, '2', 'AUXILIARY ELECTRIC HEAT SHALL BE ENABLED WHEN ANY ONE OF THE FOLLOWING CONDITIONS IS MET:', [
        'THE HEAT PUMP IS AT FULL CAPACITY AND ZONE TEMPERATURE REMAINS MORE THAN ' + V('EH_AUX_DT') + ' BELOW THE ACTIVE HEATING SETPOINT FOR ' + V('EH_AUX_MIN') + ', OR',
        'HEAT PUMP HEATING IS LOCKED OUT, OR',
        'THE CU IS IN DEFROST WHILE THE UNIT IS IN HEATING, TO TEMPER THE SUPPLY AIR.',
      ]);
      item(s, '3', 'ELECTRIC HEAT SHALL STAGE TO MAINTAIN THE HEATING SETPOINT AND DE-ENERGIZE WHEN ZONE TEMPERATURE RISES TO WITHIN ' + V('EH_OFF') + ' OF THE HEATING SETPOINT. THE HEAT PUMP SHALL REMAIN ENERGIZED.');
      item(s, '4', 'THE BAS SHALL DE-ENERGIZE ONE STAGE OF ELECTRIC HEAT IF DISCHARGE AIR TEMPERATURE EXCEEDS ' + V('DAT_HIGH') + '.');
    }

    // DEHUMIDIFICATION
    if (dehum) {
      s = sec('dehum', 'DEHUMIDIFICATION CONTROL');
      item(s, '1', 'OCCUPIED MODE: WHEN RETURN AIR RELATIVE HUMIDITY RISES ABOVE ' + V('OCC_RH_ON') + ', THE BAS SHALL INDEX THE UNIT TO DEHUMIDIFICATION. DEHUMIDIFICATION SHALL END WHEN RETURN AIR RELATIVE HUMIDITY FALLS BELOW ' + V('OCC_RH_OFF') + '.');
      item(s, '2', 'IN DEHUMIDIFICATION, THE BAS SHALL POSITION THE REVERSING VALVE TO COOLING AND STAGE THE COMPRESSOR ON RETURN AIR HUMIDITY, SUBJECT TO THE COMPRESSOR TIMERS, COIL LOW LIMIT, AND COOLING LOCKOUT.');
      if (dMode === 'full' && reheatName) {
        if (hgrh) {
          item(s, '3', (decision(j, 'hgrhValve') === 'modulating' ? 'THE BAS SHALL MODULATE THE HGRH VALVE' : 'THE BAS SHALL ENABLE HGRH') + ' TO MAINTAIN ZONE TEMPERATURE AT THE MIDPOINT BETWEEN THE ACTIVE HEATING AND COOLING SETPOINTS (ADJ.). HGRH SHALL OPERATE ONLY WITH THE REVERSING VALVE IN COOLING AND THE COMPRESSOR RUNNING.');
        } else {
          item(s, '3', 'THE BAS SHALL STAGE THE ELECTRIC HEATER AS REHEAT TO MAINTAIN ZONE TEMPERATURE AT THE MIDPOINT BETWEEN THE ACTIVE HEATING AND COOLING SETPOINTS (ADJ.). ELECTRIC REHEAT SHALL OPERATE ONLY WITH THE REVERSING VALVE IN COOLING AND THE COMPRESSOR RUNNING.');
        }
        item(s, '4', 'IF ZONE TEMPERATURE RISES ABOVE THE ACTIVE COOLING SETPOINT, THE BAS SHALL DISABLE ' + reheatName + ' AND OPERATE IN COOLING UNTIL SATISFIED, THEN RETURN TO DEHUMIDIFICATION IF THE CALL REMAINS.');
        item(s, '5', 'IF ZONE TEMPERATURE FALLS BELOW THE ACTIVE HEATING SETPOINT WITH ' + reheatName + ' ACTIVE, DEHUMIDIFICATION SHALL BE SUSPENDED AND THE UNIT SHALL TRANSITION TO HEAT PUMP HEATING AFTER THE CHANGEOVER DELAY.');
      } else {
        item(s, '3', 'ZONE LOW LIMIT: IF ZONE TEMPERATURE FALLS TO THE ACTIVE HEATING SETPOINT, DEHUMIDIFICATION SHALL BE SUSPENDED UNTIL ZONE TEMPERATURE RISES TO THE MIDPOINT BETWEEN THE ACTIVE HEATING AND COOLING SETPOINTS. NO REHEAT IS PROVIDED.');
      }
    }

    // UNOCCUPIED MODE
    s = sec('unocc', 'UNOCCUPIED MODE');
    item(s, '1', 'THE SUPPLY FAN SHALL BE OFF' + (motorized ? ' AND THE OUTSIDE AIR DAMPER CLOSED' : '') + ' EXCEPT AS FOLLOWS.');
    item(s, '2', 'UNOCCUPIED COOLING SETPOINT SHALL BE ' + V('UNOCC_CLG') + '. UNOCCUPIED HEATING SETPOINT SHALL BE ' + V('UNOCC_HTG') + '.');
    item(s, '3', 'ON A CALL FOR COOLING OR HEATING AT THE UNOCCUPIED SETPOINTS, THE BAS SHALL START THE SUPPLY FAN' + (motorized ? ' WITH THE OUTSIDE AIR DAMPER CLOSED' : '') + ' AND, UPON PROOF OF FLOW, OPERATE AS DESCRIBED ABOVE UNTIL THE ZONE IS ' + V('UNOCC_BAND') + ' INSIDE THE UNOCCUPIED SETPOINT, THEN RETURN TO OFF.');
    if (dehum) item(s, '4', 'UNOCCUPIED DEHUMIDIFICATION: WHEN RETURN AIR RELATIVE HUMIDITY RISES ABOVE ' + V('UNOCC_RH_ON') + ', THE BAS SHALL START THE SUPPLY FAN AND OPERATE IN DEHUMIDIFICATION USING THE UNOCCUPIED SETPOINTS UNTIL RETURN AIR RELATIVE HUMIDITY FALLS BELOW ' + V('UNOCC_RH_OFF') + '.');

    // SHUTDOWN
    s = sec('stop', 'SHUTDOWN SEQUENCE');
    item(s, '1', 'UPON A CALL TO ENTER UNOCCUPIED MODE OR A MANUAL STOP COMMAND, THE BAS SHALL DE-ENERGIZE ' + energized + '.');
    item(s, '2', eh
      ? 'THE SUPPLY FAN SHALL CONTINUE RUNNING FOR A ' + V('PURGE_SEC') + ' PURGE PERIOD AFTER THE ELECTRIC HEAT IS DE-ENERGIZED, THEN STOP' + (motorized ? ', AND THE OUTSIDE AIR DAMPER SHALL CLOSE.' : '.')
      : 'THE SUPPLY FAN SHALL THEN STOP' + (motorized ? ' AND THE OUTSIDE AIR DAMPER SHALL CLOSE.' : '.'));

    // SAFETIES
    s = sec('safe', 'SAFETIES AND INTERLOCKS');
    const hard = [
      anySd ? 'DUCT SMOKE DETECTOR (WHERE PROVIDED), CONNECTED TO THE FIRE ALARM SYSTEM.' : null,
      esds && esdsHard ? 'EMERGENCY HVAC SHUTDOWN SWITCH (ESDS).' : null,
      anyHs ? 'HIGH STATIC PRESSURE SWITCH, ON DUCT STATIC PRESSURE ABOVE THE DUCTWORK DESIGN LIMIT.' : null,
    ].filter(Boolean);
    if (hard.length) item(s, 'hard', 'UNIT SHUTDOWN: THE FOLLOWING SHALL STOP THE SUPPLY FAN AND DE-ENERGIZE ' + energized.replace(/^THE /, 'THE ') + ' THROUGH A HARDWIRED INTERLOCK INDEPENDENT OF THE BAS. EACH SHALL REQUIRE MANUAL RESET.', hard);
    if (esds && !esdsHard) item(s, 'esdsprog', 'UPON EMERGENCY HVAC SHUTDOWN SWITCH (ESDS) ACTIVATION, THE BAS SHALL STOP THE SUPPLY FAN AND DE-ENERGIZE ' + energized + ' UNTIL THE SWITCH IS RESET.');
    const dampers = (j.general.esdsDampers || []).filter(Boolean);
    if (esds && dampers.length) {
      const dText = dampers.length === 2 && /OUTSIDE AIR INTAKE/.test(up(dampers[0])) && /EXHAUST/.test(up(dampers[1]))
        ? 'THE BUILDING OUTSIDE AIR INTAKE AND EXHAUST LOUVERS'
        : 'THE ' + joinAnd(dampers.map(up));
      item(s, 'esdsdampers', 'UPON ESDS ACTIVATION, THE LOW-LEAKAGE MOTORIZED DAMPERS AT ' + dText + ' SHALL CLOSE THROUGH A ' + (esdsHard ? 'HARDWIRED INTERLOCK' : 'BAS COMMAND') + ' AND REMAIN CLOSED UNTIL THE SWITCH IS RESET. THE DAMPERS SHALL REMAIN OPEN AT ALL OTHER TIMES.');
    }
    if (eh) item(s, 'eh', 'THE ELECTRIC HEATER SHALL BE HARDWIRE INTERLOCKED WITH SUPPLY FAN PROOF OF FLOW AND SHALL BE EQUIPPED WITH A FACTORY HIGH-LIMIT THERMAL CUTOUT.');
    item(s, 'refrig', 'THE CU SHALL BE PROTECTED BY FACTORY HIGH/LOW REFRIGERANT PRESSURE SWITCHES. A TRIP SHALL LOCK OUT THE COMPRESSOR AND REQUIRE MANUAL RESET.');
    const condW = which((u) => u.condOverflow);
    if (condW !== null) item(s, 'cond', 'A CONDENSATE PAN HIGH LEVEL CONDITION' + condW + ' SHALL DE-ENERGIZE THE COMPRESSOR THROUGH THE OVERFLOW SWITCH AND GENERATE AN ALARM.');
    item(s, 'filter', 'A DIRTY FILTER CONDITION SHALL GENERATE A MAINTENANCE ALARM WITHOUT STOPPING THE UNIT.');

    // ALARMS
    s = sec('alarm', 'ALARMS AND NOTIFICATIONS');
    const rhAny = any((u) => u.rh);
    item(s, '1', 'THE BAS SHALL GENERATE ALARMS FOR ALL POINTS MARKED IN THE ALARM COLUMN OF THE DDC POINTS LIST, AND FOR THE FOLLOWING:', [
      'ZONE TEMPERATURE MORE THAN ' + V('ZT_ALARM_DT') + ' ABOVE OR BELOW THE ACTIVE SETPOINT FOR ' + V('ZT_ALARM_MIN') + '.',
      rhAny ? 'RETURN AIR HUMIDITY ABOVE ' + V('RH_ALARM') + ' FOR ' + V('RH_ALARM_MIN') + '.' : null,
      oaFlowW !== null ? 'OUTSIDE AIRFLOW MORE THAN ' + V('OA_ALARM_PCT') + ' BELOW THE DESIGN MINIMUM FOR ' + V('OA_ALARM_MIN') + ' WHILE THE SUPPLY FAN IS RUNNING.' : null,
      esds && dampers.length ? 'EMERGENCY SHUTDOWN DAMPER NOT CLOSED WITHIN ' + V('DAMPER_SEC') + ' OF ESDS ACTIVATION, OR NOT OPEN WITH ESDS RESET.' : null,
      'SENSOR FAILURE (' + joinAnd(['ZONE TEMPERATURE', rhAny ? 'RETURN AIR HUMIDITY' : null, 'DISCHARGE AIR TEMPERATURE']).replace(/, AND /, ', OR ').replace(/ AND /, ' OR ') + ').',
    ].filter(Boolean));
    item(s, '2', 'ALL ALARMS SHALL BE ANNUNCIATED AT THE BAS FRONT END AND SHALL BE TIME-STAMPED AND LOGGED.');

    return { header, sections: S };
  }

  /** The sequence as it will be issued: generated text, with the engineer's own edits, additions and removals applied. */
  function finalSequence(j) {
    const gen = generateSequence(j);
    const out = { header: gen.header.map((h, i) => (j.overrides['hdr.' + i] != null ? j.overrides['hdr.' + i] : h)), sections: [] };
    for (const s of gen.sections) {
      const items = [];
      for (const it of s.items) {
        if (j.removed[it.id]) continue;
        const o = j.overrides[it.id];
        items.push({
          id: it.id,
          text: up(o != null ? o.text : it.text),
          generated: it.text,
          edited: o != null,
          stale: o != null && o.base !== it.text,
          subs: it.subs.filter((x) => !j.removed[x.id]).map((x) => {
            const ox = j.overrides[x.id];
            return { id: x.id, text: up(ox != null ? ox.text : x.text), generated: x.text, edited: ox != null, stale: ox != null && ox.base !== x.text };
          }),
        });
      }
      for (const a of j.added[s.key] || []) items.push({ id: a.id, text: up(a.text), generated: null, edited: true, added: true, subs: [] });
      out.sections.push({ key: s.key, title: s.title, items });
    }
    return out;
  }

  function sequenceText(seq) {
    const lines = [];
    seq.header.forEach((h) => lines.push(h));
    for (const s of seq.sections) {
      lines.push('');
      lines.push(s.title);
      s.items.forEach((it, i) => {
        lines.push((i + 1) + '. ' + it.text);
        it.subs.forEach((x, k) => lines.push('   ' + String.fromCharCode(65 + k) + '. ' + x.text));
      });
    }
    return lines.join('\r\n') + '\r\n';
  }

  // Blanks the editor lights: [TBD: ...], [first | second], [OPTIONAL: ...]
  const BLANK_RE = /\[(TBD:[^\]]*|OPTIONAL:[^\]]*|[^\]|]+(?:\|[^\]|]+)+)\]/g;
  function blanksIn(text) {
    const out = [];
    let m;
    BLANK_RE.lastIndex = 0;
    while ((m = BLANK_RE.exec(text))) {
      const body = m[1];
      let kind = 'choice';
      if (/^TBD:/.test(body)) kind = 'tbd';
      else if (/^OPTIONAL:/.test(body)) kind = 'optional';
      out.push({ kind, start: m.index, end: m.index + m[0].length, raw: m[0], body, options: kind === 'choice' ? body.split('|').map((x) => x.trim()) : null });
    }
    return out;
  }

  // ---------------------------------------------------------------- points

  /** AHU and CU library rows switched on by the unit's features (the 7.3 mapping). */
  function ahuPointOn(p, u, j) {
    const a = p.applies.toLowerCase();
    const d = p.desc.toLowerCase();
    if (a.startsWith('always')) return true;
    if (a.includes('override')) return !!u.override;
    if (a.includes('return ts')) return !!u.rat;
    if (a.includes('dehumidification')) {
      if (d.includes('setpoint')) return !!u.rh && dehumActive(j);
      return !!u.rh;
    }
    if (a.includes('oa flow station')) return !!u.oaFlow;
    if (a.includes('high static')) return !!u.highStatic;
    if (a.includes('one per stage')) return Number(u.heatStages) > 0;
    if (a === 'electric heat') return Number(u.heatStages) > 0;
    if (a.includes('supply sd')) return !!u.supplySd;
    if (a.includes('return sd')) return !!u.returnSd;
    if (a.includes('overflow')) return !!u.condOverflow;
    if (a.includes('motorized oa damper')) return decision(j, 'oaDamper') === 'motorized';
    return false;
  }

  function cuPointOn(p, u, j) {
    const a = p.applies.toLowerCase();
    if (a.startsWith('always') || a === 'heat pump' || a.includes('one per stage')) return true;
    if (a.startsWith('hgrh')) return usesHgrh(j);
    return false;
  }

  function genericPointOn(p, u) {
    if (/^always/i.test(p.applies)) return true;
    return !!(u.conditions && u.conditions[p.applies]);
  }

  /** Expand "stage N" rows into one row per stage. */
  function expandStages(p, n) {
    if (!/stage n/i.test(p.desc)) return [{ ...p, stage: 0 }];
    const out = [];
    for (let i = 1; i <= n; i++) out.push({ ...p, desc: p.desc.replace(/stage n/i, 'stage ' + i), stage: i });
    return out;
  }

  function describe(p, j) {
    let d = up(p.desc);
    if (/LOCAL TENANT OVERRIDE/.test(d)) d = d.replace('LOCAL TENANT OVERRIDE', decision(j, 'overrideTerm') || 'LOCAL OVERRIDE');
    return d;
  }

  /**
   * Every point the job needs, unit by unit, before grouping:
   * [{ type, section, tag, desc, point, units, trend, alarm, libDesc }]
   */
  function unitPoints(j, lib) {
    const out = [];
    const push = (type, tag, p, extra) => out.push({
      type, section: sectionOf(type), tag: up(tag), desc: describe(p, j), point: p.point, units: p.units,
      trend: p.trend, alarm: p.alarm, libDesc: p.libDesc || p.desc, ...(extra || {}),
    });
    for (const u of j.units) {
      if (u.type === TYPE_AHU) {
        const t = lib.byName[TYPE_AHU];
        if (!t) continue;
        for (const p of t.points) {
          if (!ahuPointOn(p, u, j)) continue;
          const n = /electric heat stage/i.test(p.desc) ? Number(u.heatStages) || 0 : 1;
          for (const q of expandStages(p, n)) push(TYPE_AHU, u.tag, { ...q, libDesc: p.desc });
        }
        const c = lib.byName[TYPE_CU];
        if (!c) continue;
        for (const p of c.points) {
          if (!cuPointOn(p, u, j)) continue;
          let q = p;
          if (/hot gas reheat command/i.test(p.desc) && decision(j, 'hgrhValve') === 'modulating') q = { ...p, desc: 'Hot gas reheat valve command', point: 'AO', units: '%' };
          for (const r of expandStages(q, Number(u.compStages) || 1)) push(TYPE_CU, u.cu || (u.tag + ' CU'), { ...r, libDesc: p.desc });
        }
      } else {
        const t = lib.byName[u.type];
        if (!t) continue;
        for (const p of t.points) if (genericPointOn(p, u)) push(u.type, u.tag, { ...p, libDesc: p.desc });
      }
    }
    // Building-wide points
    const g = lib.byName[TYPE_GENERAL];
    if (g) {
      const needOat = ahuUnits(j).length > 0 || j.general.oat;
      for (const p of g.points) {
        const d = p.desc.toLowerCase();
        if (d.startsWith('outside air temp') && needOat) push(TYPE_GENERAL, 'BUILDING', p);
        else if (d.startsWith('emergency hvac shutdown switch') && hasEsds(j)) push(TYPE_GENERAL, 'BUILDING', p);
        else if (d.startsWith('emergency shutdown low-leakage damper') && hasEsds(j)) {
          for (const name of (j.general.esdsDampers || []).filter(Boolean)) push(TYPE_GENERAL, 'BUILDING', { ...p, desc: 'Emergency shutdown low-leakage damper end switch (' + name + ')', libDesc: p.desc });
        } else if (d.startsWith('building potable water meter alarm') && j.general.meterAlarm) push(TYPE_GENERAL, 'BUILDING', p);
        else if (d.startsWith('building potable water meter (') && j.general.waterMeter) push(TYPE_GENERAL, 'BUILDING', p);
      }
    }
    return out;
  }

  /**
   * Points list rows, grouped: units with the same point on one row ("AHU-1,2,3"),
   * per-unit differences on their own rows ("AHU-3"). Engineer's row edits and added rows applied.
   */
  function pointRows(j, lib) {
    const pts = unitPoints(j, lib);
    const rows = [];
    for (const secKey of SECTION_ORDER) {
      const inSec = pts.filter((p) => p.section === secKey);
      const extras = j.extraPoints.filter((x) => (x.section || 'HVAC') === secKey);
      if (!inSec.length && !extras.length) continue;
      rows.push({ kind: 'section', title: SECTION_TITLE[secKey] });
      // Equipment blocks in order of first appearance: AHU type, its CUs, then others.
      const blocks = [];
      for (const p of inSec) {
        const bKey = p.type;
        let b = blocks.find((x) => x.key === bKey);
        if (!b) { b = { key: bKey, points: [] }; blocks.push(b); }
        b.points.push(p);
      }
      for (const b of blocks) {
        // point identity within the block
        const order = [];
        const tagsOf = {};
        const sample = {};
        for (const p of b.points) {
          const k = p.desc + '|' + p.point + '|' + p.units;
          if (!tagsOf[k]) { tagsOf[k] = []; order.push(k); sample[k] = p; }
          if (!tagsOf[k].includes(p.tag)) tagsOf[k].push(p.tag);
        }
        const groups = [];
        for (const k of order) {
          const gk = tagsOf[k].join(',');
          let g = groups.find((x) => x.gk === gk);
          if (!g) { g = { gk, tags: tagsOf[k], keys: [] }; groups.push(g); }
          g.keys.push(k);
        }
        // the largest group (all units) first, then the rest in order of appearance
        groups.sort((a, c) => c.tags.length - a.tags.length);
        for (const g of groups) {
          g.keys.forEach((k, i) => {
            const p = sample[k];
            const key = b.key + '|' + g.gk + '|' + k;
            const e = j.pointEdits[key] || {};
            rows.push({
              kind: 'point', key, type: b.key, tags: g.tags,
              equipment: e.equipment != null ? e.equipment : (i === 0 ? compressTags(g.tags) : ''),
              desc: e.desc != null ? up(e.desc) : p.desc,
              point: e.point != null ? e.point : p.point,
              units: e.units != null ? e.units : p.units,
              trend: e.trend != null ? e.trend : p.trend,
              alarm: e.alarm != null ? e.alarm : p.alarm,
              libDesc: p.libDesc, removed: !!e.removed, edited: Object.keys(e).some((x) => x !== 'removed'),
            });
          });
        }
      }
      for (const x of extras) {
        rows.push({
          kind: 'point', key: 'extra|' + x.id, extra: x, type: x.type || '', tags: [],
          equipment: up(x.equipment || ''), desc: up(x.desc || ''), point: x.point || '', units: x.units || '',
          trend: !!x.trend, alarm: !!x.alarm, libDesc: x.libDesc || null, removed: false, added: true,
        });
      }
    }
    return rows;
  }

  const activeRows = (rows) => rows.filter((r) => r.kind === 'section' || !r.removed);

  // ---------------------------------------------------------------- library check and update

  /** Types used on the job. */
  function jobTypes(j) {
    const t = [];
    const add = (n) => { if (n && !t.includes(n)) t.push(n); };
    for (const u of j.units) { add(u.type); if (u.type === TYPE_AHU) add(TYPE_CU); }
    add(TYPE_GENERAL);
    return t;
  }

  /** Library points of each job type that are not on the job's points list. */
  function libraryCheck(j, lib) {
    const rows = activeRows(pointRows(j, lib)).filter((r) => r.kind === 'point');
    const used = new Set(rows.map((r) => (r.type || '') + '|' + (r.libDesc || '').toLowerCase()));
    const usedDesc = new Set(rows.map((r) => r.desc.toLowerCase()));
    const out = [];
    for (const typeName of jobTypes(j)) {
      const t = lib.byName[typeName];
      if (!t) continue;
      for (const p of t.points) {
        const k = typeName + '|' + p.desc.toLowerCase();
        if (used.has(k) || usedDesc.has(up(p.desc).toLowerCase())) continue;
        const key = typeName + '|' + p.desc + '|' + p.applies;
        out.push({ key, type: typeName, point: p, answer: j.libAnswers[key] || null });
      }
    }
    return out;
  }

  /** Library with this job's new equipment types and points added, tagged with the job code. */
  function libraryUpdate(j, lib) {
    const next = clone({ types: lib.types });
    next.byName = {};
    next.types.forEach((t) => { next.byName[t.name] = t; });
    const code = j.code || 'JOB';
    const added = [];
    for (const x of j.extraPoints) {
      if (x.libDesc) continue; // came from the library
      const typeName = x.type || 'Other';
      if (!next.byName[typeName]) { next.byName[typeName] = { name: typeName, section: sectionOf(typeName), points: [] }; next.types.push(next.byName[typeName]); }
      const t = next.byName[typeName];
      if (t.points.some((p) => p.desc.toLowerCase() === String(x.desc).toLowerCase())) continue;
      const p = { desc: x.desc, point: x.point, units: x.units, trend: !!x.trend, alarm: !!x.alarm, applies: x.applies || 'Add as needed', source: code };
      t.points.push(p);
      added.push({ type: typeName, point: p });
    }
    return { lib: next, added };
  }

  // ---------------------------------------------------------------- checks

  function allSeqText(seq) {
    return [...seq.header, ...seq.sections.flatMap((s) => [s.title, ...s.items.flatMap((i) => [i.text, ...i.subs.map((x) => x.text)])])].join('\n');
  }

  /** Checks on the sequence and points list together. level: fix | look | info */
  function checkJob(j, lib) {
    const f = [];
    const add = (level, area, text, ref) => f.push({ level, area, text, ref });
    const seq = finalSequence(j);
    const text = allSeqText(seq);
    const rows = activeRows(pointRows(j, lib)).filter((r) => r.kind === 'point');
    const units = ahuUnits(j);

    // decisions and blanks
    for (const d of openDecisions(j)) add('fix', 'Decisions', 'Confirm: ' + d.title.toLowerCase() + '.', 'decision:' + d.key);
    for (const s of seq.sections) for (const it of s.items) {
      for (const x of [it, ...it.subs]) {
        for (const b of blanksIn(x.text)) add('fix', 'Sequence', (b.kind === 'tbd' ? 'Fill in: ' + b.body.slice(4).trim().toLowerCase() : b.kind === 'choice' ? 'Choose a wording' : 'Keep or delete the optional paragraph') + ' (' + s.title.toLowerCase() + ').', 'item:' + x.id);
        if (x.stale) add('look', 'Sequence', 'Your edit in ' + s.title.toLowerCase() + ' was written before a later change to the units or decisions. Compare it with the new wording.', 'item:' + x.id);
      }
    }

    // style
    if (/[—–]/.test(text)) add('fix', 'Style', 'The sequence has a long dash. Use a period, comma or colon.');
    if (/\bBMS\b/.test(text)) add('fix', 'Style', 'Use "BAS", not "BMS".');
    if (/\(ADJ\)/.test(text)) add('fix', 'Style', 'Write "(ADJ.)" with the period.');
    if (/STOP\/STOP/.test(text)) add('fix', 'Style', '"STOP/STOP" typo.');
    const noAdj = [];
    const numRe = /(\d+(?:\.\d+)?)(°F|% RH|%RH|%| MINUTES| MINUTE| SECONDS| SECOND| HOURS| HOUR|-SECOND)(?![A-Z])/g;
    let m;
    while ((m = numRe.exec(text))) {
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 40);
      if (/^\s*\(ADJ\.\)/.test(after)) continue;
      noAdj.push(m[0]);
    }
    if (noAdj.length) add('fix', 'Style', 'Values without "(ADJ.)": ' + [...new Set(noAdj)].slice(0, 6).join(', ') + '.');
    for (const r of rows) if (/\bB[IO]\b/.test(r.point)) add('fix', 'Points list', r.desc + ': use DI/DO, not BI/BO.');
    const heaterNames = ['REHEAT ELEMENT', 'DUCT HEATER', 'ELECTRIC COIL', 'HEATING ELEMENT', 'STRIP HEAT'].filter((n) => text.includes(n));
    if (heaterNames.length) add('look', 'Style', 'The electric heater is also called ' + heaterNames.map((n) => '"' + n + '"').join(', ') + '. Use one name.');
    if (j.government && /TENANT/.test(text)) add('look', 'Style', '"TENANT" is a commercial term. Consider "LOCAL OVERRIDE" on a government job.');

    // conflicts with the units and decisions
    if (units.length && units.every((u) => Number(u.compStages) <= 1 && Number(u.heatStages) <= 1) && /STAGE 2|INTERSTAGE/.test(text)) add('fix', 'Sequence', 'The text mentions stage 2 or an interstage delay, but every unit is single stage.');
    if (decision(j, 'oaDamper') !== 'motorized') {
      for (const s of seq.sections) for (const it of s.items) {
        if (/DAMPERS? SHALL CLOSE/.test(it.text) && !/LOW-LEAKAGE|ESDS/.test(it.text)) add('fix', 'Sequence', 'A damper is told to close, but outside air is set by a manual damper only (' + s.title.toLowerCase() + ').', 'item:' + it.id);
      }
    }
    if (/ELECTRIC HEAT[^.]*MODULAT/.test(text)) add('fix', 'Sequence', 'The electric heater is contactor staged, not modulating.');
    const titles = seq.sections.map((s) => s.title);
    const xref = /(?:UNDER|SEE|IN|PER) (?:THE )?([A-Z/ ]+?(?:CONTROL|MODE|SEQUENCE|INTERLOCKS|NOTIFICATIONS))\b/g;
    while ((m = xref.exec(text))) {
      const name = m[1].trim();
      if (!titles.some((t) => t === name || t.endsWith(name)) && !/^(OCCUPIED|UNOCCUPIED) MODE$/.test(name) && !/^(COOLING|HEATING|DEHUMIDIFICATION)$/.test(name)) {
        if (/CONTROL$|SEQUENCE$|INTERLOCKS$|NOTIFICATIONS$/.test(name) && !/^(BAS|DDC)/.test(name) && name.split(' ').length <= 4 && !/THROUGH|DIRECT DIGITAL/.test(name)) add('fix', 'Sequence', 'It refers to "' + name + '", which is not a section.');
      }
    }

    // three-way cross-check: sequence words <-> points list
    const has = (re) => rows.some((r) => re.test(r.desc));
    const TRACE = [
      { word: /RELATIVE HUMIDITY|HUMIDITY SENSOR/, point: /RELATIVE HUMIDITY/, name: 'return air humidity', control: true },
      { word: /INDEX THE UNIT TO DEHUMIDIFICATION/, point: /HUMIDITY SETPOINT/, name: 'humidity setpoint', control: true },
      { word: /OUTSIDE AIRFLOW/, point: /OUTSIDE AIRFLOW/, name: 'outside airflow', control: true },
      { word: /LEAVING AIR TEMPERATURE/, point: /LEAVING AIR TEMP/, name: 'DX/HP coil leaving air temp', control: true },
      { word: /DISCHARGE AIR TEMPERATURE/, point: /DISCHARGE AIR TEMP/, name: 'discharge air temp', control: true },
      { word: /DEFROST/, point: /DEFROST/, name: 'defrost status', control: true },
      { word: /REVERSING VALVE/, point: /REVERSING VALVE/, name: 'reversing valve', control: true },
      { word: /\bHGRH\b|HOT GAS REHEAT/, point: /HOT GAS REHEAT/, name: 'hot gas reheat', control: true },
      { word: /SMOKE DETECTOR/, point: /SMOKE DETECTOR/, name: 'duct smoke detector', control: true },
      { word: /HIGH STATIC/, point: /HIGH STATIC/, name: 'high static switch', control: true },
      { word: /EMERGENCY HVAC SHUTDOWN|\bESDS\b/, point: /EMERGENCY HVAC SHUTDOWN/, name: 'emergency HVAC shutdown switch', control: true },
      { word: /LOW-LEAKAGE/, point: /DAMPER END SWITCH/, name: 'emergency damper end switch', control: true },
      { word: /OUTSIDE AIR TEMPERATURE/, point: /OUTSIDE AIR TEMP/, name: 'outside air temp', control: false },
      { word: /HIGH-LIMIT|HIGH LIMIT/, point: /HIGH LIMIT/, name: 'electric heater high limit', control: true },
      { word: /FILTER/, point: /FILTER/, name: 'filter status', control: true },
      { word: /OVERRIDE/, point: /OVERRIDE/, name: 'override', control: true },
      { word: /PROOF OF (AIR)?FLOW/, point: /SUPPLY FAN STATUS/, name: 'supply fan status', control: true },
      { word: /REFRIGERANT PRESSURE/, point: /REFRIGERANT PRESSURE/, name: 'refrigerant pressure fault', control: true },
      { word: /CONDENSATE PAN/, point: /CONDENSATE PAN/, name: 'condensate pan high level', control: true },
      { word: /MOTORIZED OUTSIDE AIR DAMPER|OUTSIDE AIR DAMPER SHALL OPEN/, point: /MOTORIZED OA DAMPER/, name: 'motorized OA damper', control: true },
      { word: /STAGE 2/, point: /STAGE 2/, name: 'stage 2', control: false },
    ];
    if (units.length) {
      for (const t of TRACE) {
        const inSeq = t.word.test(text);
        const onList = has(t.point);
        if (inSeq && !onList) add('fix', 'Cross-check', 'The sequence uses ' + t.name + ', but the points list has no ' + t.name + ' point.');
        if (!inSeq && onList && t.control) add('look', 'Cross-check', 'The points list has ' + t.name + ', but the sequence never uses it.');
      }
    }
    // alarms the condensed sequence leaves to the points list
    const MUST_ALARM = [/SMOKE DETECTOR/, /EMERGENCY HVAC SHUTDOWN/, /DAMPER END SWITCH/, /HIGH STATIC/, /REFRIGERANT PRESSURE/, /HIGH LIMIT/, /FILTER STATUS/, /CONDENSATE/, /SUPPLY FAN STATUS/, /ZONE TEMP$/, /DISCHARGE AIR TEMP/];
    for (const r of rows) if (MUST_ALARM.some((re) => re.test(r.desc)) && !r.alarm) add('fix', 'Points list', r.desc + (r.equipment ? ' (' + r.equipment + ')' : '') + ': mark the Alarm column. The sequence relies on the points list for this alarm.');

    // engineering checks
    for (const e of engineeringChecks(j)) f.push(e);
    return f;
  }

  function engineeringChecks(j) {
    const f = [];
    const add = (text) => f.push({ level: 'look', area: 'Engineering', text });
    const units = ahuUnits(j);
    const reheat = reheatSource(j);
    if (dehumActive(j) && reheat === 'electric') {
      for (const u of units) {
        const mbh = Number(u.coolingMbh);
        if (!mbh) add(up(u.tag) + ': no cooling capacity entered. Needed to check the ASHRAE 90.1 reheat limits.');
        else if (mbh > 80) add(up(u.tag) + ' (' + mbh + ' MBH): electric reheat for dehumidification is over the ASHRAE 90.1 6.5.2.3 exceptions (40 MBH, or 80 MBH with unloading to 50%). Use hot gas reheat or dehumidify without reheat. Verify against the adopted edition.');
        else if (mbh > 40) add(up(u.tag) + ' (' + mbh + ' MBH): electric reheat is allowed only if the unit unloads to 50% before reheat (ASHRAE 90.1 6.5.2.3). Verify against the adopted edition.');
      }
    }
    for (const u of units) {
      const cfm = Number(u.cfm);
      if (cfm > 2000 && !u.returnSd) add(up(u.tag) + ' (' + cfm.toLocaleString('en-US') + ' CFM): over the IMC 2,000 CFM threshold for a return duct smoke detector, but none is selected. Check the schedule notes and fire alarm drawings. Verify against the adopted edition.');
      if (!u.cfm) add(up(u.tag) + ': no supply CFM entered. Needed for the smoke detector check.');
    }
    const clg = value(j, 'CLG_LOCKOUT');
    if (clg !== null && clg !== '' && Number(clg) < 40 && units.length) add('Cooling lockout at ' + clg + '°F: cooling below about 40°F usually needs a low-ambient kit on the condensing unit. Confirm with the manufacturer.');
    if (units.length && decision(j, 'oaDamper') !== 'motorized') add('Manual outside air damper only: when the fan cycles in unoccupied mode it brings in humid outside air.');
    if (hasEsds(j)) {
      if (esdsMode(j) === 'programmed') add('The emergency shutdown switch is programmed through the BAS. Make sure the control notes sheet says the same.');
      if (j.units.some((u) => /exhaust/i.test(u.type) && u.conditions && u.conditions['Lights-interlocked fans'])) add('Lights-interlocked exhaust fans need a relay to be stopped by the emergency shutdown switch. Coordinate with electrical.');
      add('Emergency shutdown switch: confirm the equipment it stops and the dampers it closes.');
    }
    if (j.humid && dehumMode(j) === 'monitor') add('Humid climate with no dehumidification control. Consider a dehumidification mode.');
    if (dehumMode(j) !== 'monitor' && units.length && !units.some((u) => u.rh)) add('Dehumidification is selected, but no unit has a return air humidity sensor.');
    return f;
  }

  // ---------------------------------------------------------------- draft review (Section 5.2)

  function sentences(text) {
    return up(text).replace(/\r/g, '').split(/(?<=\.)\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  }

  /** Reviews a pasted draft sequence. Returns [{group: Conflict|Gap|Cleanup, text, quote}] */
  function reviewDraft(draft, j) {
    const out = [];
    const add = (group, text, quote) => out.push({ group, text, quote: quote ? quote.slice(0, 200) : '' });
    const T = up(draft || '');
    if (!T.trim()) return out;
    const S = sentences(draft);
    const find = (re) => S.find((s) => re.test(s));
    const units = ahuUnits(j);

    // Conflicts
    const sat = find(/(SUPPLY|DISCHARGE) AIR TEMPERATURE (SETPOINT )?(OF |AT |SHALL BE )?\d+/);
    if (sat && /ZONE TEMPERATURE/.test(T)) add('Conflict', 'Zone temperature control in one place, a fixed supply air temperature in another.', sat);
    const ehHold = find(/ELECTRIC (HEAT|HEATER|REHEAT)[^.]*(COOLING SETPOINT|SUPPLY AIR (TEMPERATURE )?SETPOINT|REHEAT|DEHUMIDIF)/) || find(/(REHEAT|DEHUMIDIF)[^.]*ELECTRIC (HEAT|HEATER)/);
    if (ehHold && !/SHALL NOT BE USED/.test(ehHold)) add('Conflict', 'Electric heat is used as reheat (holding a cooling or supply air setpoint). Check ASHRAE 90.1 reheat limits.', ehHold);
    const ehFirst = find(/ELECTRIC (HEAT|HEATER)[^.]*(FIRST STAGE|STAGE 1 HEAT|PRIOR TO|BEFORE THE HEAT PUMP|PRIMARY)/) || find(/(FIRST STAGE|STAGE 1) (OF )?HEAT[^.]*ELECTRIC/);
    if (ehFirst) add('Conflict', 'Electric heat comes on before the heat pump. The heat pump should be primary, electric heat auxiliary.', ehFirst);
    const lock = S.filter((s) => /LOCK(ED)? ?OUT/.test(s));
    const both = lock.find((s) => /COOL|COMPRESSOR/.test(s) && /HEAT/.test(s) && (s.match(/\d+\s*°?\s*F/g) || []).length === 1);
    if (both) add('Conflict', 'One lockout value is used for both cooling and heat pump heating. Keep two separate setpoints.', both);
    const lockFan = lock.find((s) => /FAN|UNIT SHALL NOT START|PREVENT THE UNIT|SHUT DOWN THE UNIT/.test(s) && !/SHALL NOT PREVENT/.test(s));
    if (lockFan) add('Conflict', 'A compressor lockout stops the supply fan. It should block only the compressor.', lockFan);
    const allOf = /ALL OF THE FOLLOWING/.exec(T);
    if (allOf && /\bOR\b/.test(T.slice(allOf.index, allOf.index + 500))) add('Conflict', '"ALL OF THE FOLLOWING" is followed by conditions joined by "OR". Use "ANY ONE OF THE FOLLOWING".', T.slice(allOf.index, allOf.index + 120));
    if (units.length && units.every((u) => Number(u.compStages) <= 1 && Number(u.heatStages) <= 1)) {
      const st = find(/\bSTAGED\b|INTERSTAGE|STAGE 2|SECOND STAGE/);
      if (st) add('Conflict', 'Staging language, but every unit is scheduled single stage.', st);
    } else if (units.some((u) => Number(u.compStages) <= 1) && units.some((u) => Number(u.compStages) > 1)) {
      if (!/\b(AHU|RTU|FCU)-\d+[^.]*STAGE/.test(T)) add('Conflict', 'Units in this typical sequence have different stages, but the text does not say which unit has which.');
    }
    if (decision(j, 'oaDamper') !== 'motorized') {
      const dc = find(/DAMPERS? SHALL CLOSE/);
      if (dc && !/LOW-LEAKAGE|EMERGENCY|ESDS/.test(dc)) add('Conflict', 'Dampers are told to close, but outside air is set by a manual damper only.', dc);
    }
    const mod = find(/(ELECTRIC (HEAT|HEATER)[^.]*MODULAT)|(MODULAT[^.]*ELECTRIC (HEAT|HEATER))/);
    if (mod) add('Conflict', 'A contactor-staged heater is described as modulating.', mod);
    const heads = (draft.match(/^\s*([A-Z][A-Z /&-]{3,})\s*$/gm) || []).map((h) => h.trim());
    const xr = /(?:REFER TO|SEE|AS DESCRIBED IN|PER) (?:THE )?(?:SECTION )?["']?([A-Z][A-Z /&-]+?)["']?(?: SECTION)?[.,;)]/g;
    let m;
    while ((m = xr.exec(T))) {
      const name = m[1].trim();
      if (heads.length && !heads.some((h) => h.includes(name) || name.includes(h)) && name.length > 4 && !/DDC POINTS LIST|POINTS LIST|SCHEDULE|DRAWINGS|SPECIFICATION/.test(name)) add('Conflict', 'Cross-reference to "' + name + '", which is not a section of this sequence.', m[0]);
    }
    const names = ['REHEAT ELEMENT', 'ELECTRIC HEATER', 'AUXILIARY HEAT', 'DUCT HEATER', 'ELECTRIC COIL', 'STRIP HEAT', 'HEATING ELEMENT'].filter((n) => T.includes(n));
    if (names.length >= 2) add('Conflict', 'One device goes by several names: ' + names.map((n) => '"' + n + '"').join(', ') + '. Use one name.');

    // Gaps
    const hasDehumMode = /DEHUMIDIF/.test(T);
    if (/HUMIDITY|\bRH\b/.test(T) && !hasDehumMode) add('Gap', 'A humidity sensor is mentioned, but there is no dehumidification mode.');
    else if (units.some((u) => u.rh) && !hasDehumMode) add('Gap', 'The units have a return humidity sensor, but the draft has no dehumidification mode.');
    if (!hasDehumMode && j.humid) add('Gap', 'Humid climate, but no dehumidification mode (occupied or unoccupied).');
    if (hasDehumMode && !/UNOCCUPIED[^.]*DEHUMIDIF|DEHUMIDIF[^.]*UNOCCUPIED/.test(T) && j.humid) add('Gap', 'No unoccupied dehumidification.');
    if (hasEsds(j) && !/EMERGENCY (HVAC )?SHUT ?DOWN|\bESDS\b/.test(T)) add('Gap', 'An emergency HVAC shutdown switch is on the job, but not in the sequence.');
    if (!/DEFROST/.test(T)) add('Gap', 'Defrost is not addressed. The CU factory controller handles it; the BAS monitors it and tempers supply air with auxiliary heat.');
    const smoke = find(/SMOKE/);
    if (smoke && !/HARDWIRE|HARD-WIRE|INDEPENDENT|FIRE ALARM/.test(T)) add('Gap', 'Smoke detector shutdown is not stated as hardwired and independent of the BAS.', smoke);
    const ov = find(/OVERRIDE/);
    if (ov && !/\d+\s*(HOUR|HR|MINUTE)/.test(ov)) add('Gap', 'Override duration is not defined.', ov);
    if (!/LOW LIMIT|LOW-LIMIT|FREEZE/.test(T)) add('Gap', 'No coil low limit.');
    const alarmMissing = [
      [/SMOKE/, 'smoke'], [/EMERGENCY|ESDS/, 'emergency shutdown'], [/HUMIDITY[^.]*ALARM|ALARM[^.]*HUMIDITY/, 'high humidity'],
      [/ZONE TEMPERATURE[^.]*(ALARM|DEVIAT)|(ALARM|DEVIAT)[^.]*ZONE TEMPERATURE/, 'zone temperature deviation'],
      [/(OUTSIDE AIRFLOW|OA FLOW|OUTSIDE AIR FLOW)[^.]*ALARM|ALARM[^.]*(OUTSIDE AIRFLOW|OA FLOW)/, 'low outside airflow'],
    ].filter(([re]) => !re.test(T)).map(([, n]) => n);
    if (alarmMissing.length) add('Gap', 'Alarms missing: ' + alarmMissing.join(', ') + '.');
    if (units.some((u) => u.oaFlow) && !/AIRFLOW|FLOW STATION|FLOW MEASURING|OA FLOW/.test(T)) add('Gap', 'An outside airflow station is on the units, but the draft never uses it.');

    // Cleanup
    const mn = find(/MINIMUM[^.]*(ON|OFF)[^.]*TIME|MINIMUM (RUN|OFF)/);
    if (mn && (mn.match(/\d+/g) || []).length < 2) add('Cleanup', 'Minimum on/off time wording is unclear. State both times.', mn);
    if (/STOP\/STOP/.test(T)) add('Cleanup', '"STOP/STOP" typo.');
    if (/\bBMS\b/.test(T)) add('Cleanup', 'Use "BAS", not "BMS".');
    if (/[—–]/.test(draft)) add('Cleanup', 'Long dashes in the text.');
    if (/\bB[IO]\b/.test(T)) add('Cleanup', 'Use DI/DO, not BI/BO.');
    if (j.government && /TENANT/.test(T)) add('Cleanup', '"TENANT" is a commercial term on a government job. Ask before changing.', find(/TENANT/));
    if (/\(ADJ\)/.test(T)) add('Cleanup', 'Write "(ADJ.)" with the period.');
    const noAdj = (T.match(/\d+(\.\d+)?\s*(°F|DEG(REES)? F|% ?RH|MINUTES?|SECONDS?)(?![A-Z])(?!\s*\(ADJ)/g) || []).length;
    if (noAdj) add('Cleanup', noAdj + ' setpoint' + (noAdj === 1 ? '' : 's') + ' or delay' + (noAdj === 1 ? '' : 's') + ' without "(ADJ.)".');
    if (/[a-z]{3,}/.test(draft) && !/[A-Z]{3,}/.test(draft.replace(/[a-z]/g, ''))) add('Cleanup', 'Not in ALL CAPS.');
    return out;
  }

  // ---------------------------------------------------------------- zip (stored, no compression)

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function utf8(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
    return Uint8Array.from(Buffer.from(s, 'utf8'));
  }
  function zip(files) { // files: [{name, data: string|Uint8Array}]
    const parts = [], central = [];
    let offset = 0;
    const u16 = (v) => [v & 0xff, (v >>> 8) & 0xff];
    const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
    for (const f of files) {
      const name = utf8(f.name);
      const data = typeof f.data === 'string' ? utf8(f.data) : f.data;
      const crc = crc32(data);
      const local = Uint8Array.from([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)]);
      parts.push(local, name, data);
      central.push(Uint8Array.from([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
      offset += local.length + name.length + data.length;
    }
    const cdSize = central.reduce((a, b) => a + b.length, 0);
    const end = Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
    const all = [...parts, ...central, end];
    const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
    let p = 0;
    for (const a of all) { out.set(a, p); p += a.length; }
    return out;
  }

  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ---------------------------------------------------------------- Word (.docx) for Link Word Notes

  function docx(seq) {
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const run = (t, o) => '<w:r>' + (o ? '<w:rPr>' + (o.b ? '<w:b/>' : '') + (o.u ? '<w:u w:val="single"/>' : '') + '</w:rPr>' : '') + '<w:t xml:space="preserve">' + esc(t) + '</w:t></w:r>';
    const body = [];
    seq.header.forEach((h) => body.push('<w:p><w:pPr><w:pStyle w:val="Title1"/></w:pPr>' + run(h, { b: true }) + '</w:p>'));
    seq.sections.forEach((s, si) => {
      body.push('<w:p><w:pPr><w:pStyle w:val="SectionHead"/></w:pPr>' + run(s.title, { b: true, u: true }) + '</w:p>');
      const numId = si + 1;
      s.items.forEach((it) => {
        body.push('<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="' + numId + '"/></w:numPr></w:pPr>' + run(it.text) + '</w:p>');
        it.subs.forEach((x) => body.push('<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="1"/><w:numId w:val="' + numId + '"/></w:numPr></w:pPr>' + run(x.text) + '</w:p>'));
      });
    });
    const document = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + W + '><w:body>' + body.join('')
      + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>';
    const lvl = (i, fmt, text, left) => '<w:lvl w:ilvl="' + i + '"><w:start w:val="1"/><w:numFmt w:val="' + fmt + '"/><w:lvlText w:val="' + text + '"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="' + left + '" w:hanging="360"/></w:pPr></w:lvl>';
    const abstract = '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="multilevel"/>' + lvl(0, 'decimal', '%1.', 360) + lvl(1, 'upperLetter', '%2.', 720)
      + [2, 3, 4, 5, 6, 7, 8].map((i) => lvl(i, 'decimal', '%' + (i + 1) + '.', 360 * (i + 1))).join('') + '</w:abstractNum>';
    const nums = seq.sections.map((s, i) => '<w:num w:numId="' + (i + 1) + '"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride><w:lvlOverride w:ilvl="1"><w:startOverride w:val="1"/></w:lvlOverride></w:num>').join('');
    const numbering = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ' + W + '>' + abstract + nums + '</w:numbering>';
    const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ' + W + '>'
      + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial Narrow" w:hAnsi="Arial Narrow" w:cs="Arial Narrow"/><w:sz w:val="20"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="60"/></w:pPr></w:pPrDefault></w:docDefaults>'
      + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
      + '<w:style w:type="paragraph" w:styleId="Title1"><w:name w:val="SOO Title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>'
      + '<w:style w:type="paragraph" w:styleId="SectionHead"><w:name w:val="SOO Section"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="160"/></w:pPr><w:rPr><w:b/><w:u w:val="single"/></w:rPr></w:style>'
      + '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/></w:style>'
      + '</w:styles>';
    return zip([
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
      { name: 'word/_rels/document.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>' },
      { name: 'word/document.xml', data: document },
      { name: 'word/styles.xml', data: styles },
      { name: 'word/numbering.xml', data: numbering },
    ]);
  }

  // ---------------------------------------------------------------- Excel (.xlsx) on the points list template layout

  const POINTS_NOTES = [
    "1. ALARM SHALL BE GENERATED IF BINARY PROOF ≠ BINARY COMMAND SET TO 'ON' PLUS TWO POLLING INTERVALS (NO LESS THAN ONE MINUTE INTERVALS).",
    '2. ALL SETPOINTS, ALARM LIMITS, AND TIME DELAYS INDICATED AS (ADJ.) IN THE SEQUENCE OF OPERATIONS SHALL BE ADJUSTABLE AT THE DDC SYSTEM.',
    '3. DDC SHALL DISPLAY ALL STAGES OF HEAT.',
    '4. WHERE MULTIPLE EQUIPMENT TAGS ARE LISTED ON A SINGLE ROW, THE POINTS INDICATED SHALL BE PROVIDED FOR EACH UNIT LISTED. QUANTITIES SHOWN ARE PER UNIT, TYPICAL.',
  ];
  const ABBREVIATIONS = ['AI - ANALOG INPUT', 'AO - ANALOG OUTPUT', 'DI - DIGITAL INPUT', 'DO - DIGITAL OUTPUT', 'AV - ANALOG VALUE'];

  /**
   * Builds the points list workbook. Table in A:F, title merged A:F, header row, section rows in bold,
   * medium border on the outer left, right and bottom, thin elsewhere, points columns centered,
   * notes and abbreviations below the table (blank row between blocks), fit to one page wide.
   */
  function xlsx(rows) {
    const r = activeRows(rows);
    const fonts = ['<font><sz val="10"/><name val="Arial"/></font>', '<font><b/><sz val="10"/><name val="Arial"/></font>', '<font><b/><sz val="14"/><name val="Arial"/></font>', '<font><b/><u/><sz val="10"/><name val="Arial"/></font>'];
    const borders = [];
    const borderIdx = (b) => {
      const x = '<border>' + ['left', 'right', 'top', 'bottom'].map((s) => (b[s] ? '<' + s + ' style="' + b[s] + '"><color auto="1"/></' + s + '>' : '<' + s + '/>')).join('') + '<diagonal/></border>';
      let i = borders.indexOf(x); if (i < 0) { borders.push(x); i = borders.length - 1; } return i;
    };
    borderIdx({});
    const xfs = [];
    const xfIdx = (font, b, align, wrap) => {
      const x = '<xf numFmtId="0" fontId="' + font + '" fillId="0" borderId="' + borderIdx(b) + '" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment' + (align ? ' horizontal="' + align + '"' : '') + ' vertical="center"' + (wrap ? ' wrapText="1"' : '') + '/></xf>';
      let i = xfs.indexOf(x); if (i < 0) { xfs.push(x); i = xfs.length - 1; } return i;
    };
    xfIdx(0, {}, null);

    const COLS = ['A', 'B', 'C', 'D', 'E', 'F'];
    const table = [];
    table.push({ cells: ['Equipment Schedule Points List', '', '', '', '', ''], kind: 'title' });
    table.push({ cells: ['Equipment', 'POINT DESCRIPTIONS', 'POINT', 'UNITS', 'TREND', 'ALARM'], kind: 'head' });
    for (const x of r) {
      if (x.kind === 'section') table.push({ cells: ['', x.title, '', '', '', ''], kind: 'section' });
      else table.push({ cells: [x.equipment, x.desc, x.point, x.units, x.trend ? 'X' : '', x.alarm ? 'X' : ''], kind: 'point' });
    }
    const last = table.length;
    const xml = [];
    table.forEach((row, i) => {
      const rn = i + 1;
      const cells = row.cells.map((v, c) => {
        const b = { left: c === 0 ? 'medium' : 'thin', right: c === 5 ? 'medium' : 'thin', top: 'thin', bottom: rn === last ? 'medium' : 'thin' };
        if (row.kind === 'title') { b.top = 'medium'; if (c > 0) b.left = null; if (c < 5) b.right = null; }
        const font = row.kind === 'title' ? 2 : (row.kind === 'head' || row.kind === 'section') ? 1 : 0;
        const align = row.kind === 'title' ? 'center' : c >= 2 || row.kind === 'head' ? 'center' : 'left';
        const s = xfIdx(font, b, align, c === 1 && row.kind === 'point');
        const ref = COLS[c] + rn;
        return v === '' ? '<c r="' + ref + '" s="' + s + '"/>' : '<c r="' + ref + '" s="' + s + '" t="inlineStr"><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
      }).join('');
      xml.push('<row r="' + rn + '"' + (row.kind === 'title' ? ' ht="24" customHeight="1"' : '') + '>' + cells + '</row>');
    });
    let rn = last + 2;
    const plain = xfIdx(0, {}, 'left');
    const bold = xfIdx(3, {}, 'left');
    const line = (t, s) => { xml.push('<row r="' + rn + '"><c r="A' + rn + '" s="' + s + '" t="inlineStr"><is><t xml:space="preserve">' + esc(t) + '</t></is></c></row>'); rn++; };
    line('POINTS LIST NOTES:', bold);
    POINTS_NOTES.forEach((t) => line(t, plain));
    rn++;
    line('ABBREVIATIONS:', bold);
    ABBREVIATIONS.forEach((t) => line(t, plain));
    const lastRow = rn - 1;

    const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:F' + lastRow + '"/><sheetViews><sheetView workbookViewId="0" view="pageBreakPreview"/></sheetViews><sheetFormatPr defaultRowHeight="13.2"/>'
      + '<cols><col min="1" max="1" width="16" customWidth="1"/><col min="2" max="2" width="62" customWidth="1"/><col min="3" max="3" width="9" customWidth="1"/><col min="4" max="4" width="13" customWidth="1"/><col min="5" max="6" width="9" customWidth="1"/></cols>'
      + '<sheetData>' + xml.join('') + '</sheetData><mergeCells count="1"><mergeCell ref="A1:F1"/></mergeCells>'
      + '<pageMargins left="0.5" right="0.5" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup orientation="portrait" fitToWidth="1" fitToHeight="0"/></worksheet>';
    const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<fonts count="' + fonts.length + '">' + fonts.join('') + '</fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
      + '<borders count="' + borders.length + '">' + borders.join('') + '</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + '<cellXfs count="' + xfs.length + '">' + xfs.join('') + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
    const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Points List" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">\'Points List\'!$A$1:$F$' + lastRow + '</definedName></definedNames></workbook>';
    return zip([
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', data: workbook },
      { name: 'xl/styles.xml', data: styles },
      { name: 'xl/worksheets/sheet1.xml', data: sheet },
    ]);
  }

  // ---------------------------------------------------------------- decision log

  function decisionLog(j, lib) {
    const L = [];
    const rev = j.revision || '(not issued)';
    L.push('# ' + (j.code || 'Job') + (j.title ? ': ' + j.title : '') + ' decision log');
    L.push('');
    L.push('Revision: ' + rev + '. Written ' + today() + '. Sequence, points list and schematics carry the same revision letter.');
    L.push('');
    L.push('## Equipment');
    L.push('');
    L.push('| Unit | CU | Compressor stages | Electric heat stages | CFM | OA CFM | Cooling MBH | Smoke detectors | Features |');
    L.push('|---|---|---|---|---|---|---|---|---|');
    for (const u of ahuUnits(j)) {
      const sd = u.supplySd && u.returnSd ? 'Supply and return' : u.supplySd ? 'Supply' : u.returnSd ? 'Return' : 'None';
      const feats = [u.rh && 'RA humidity', u.oaFlow && 'OA flow station', u.highStatic && 'High static switch', u.override && 'Override', u.rat && 'RA temp', u.condOverflow && 'Condensate overflow'].filter(Boolean).join(', ');
      L.push('| ' + [u.tag, u.cu, u.compStages, u.heatStages, u.cfm, u.oaCfm, u.coolingMbh, sd, feats].join(' | ') + ' |');
    }
    for (const u of j.units.filter((x) => x.type !== TYPE_AHU)) {
      const c = Object.keys(u.conditions || {}).filter((k) => u.conditions[k]);
      L.push('| ' + [u.tag, '', '', '', '', '', '', '', u.type + (c.length ? ': ' + c.join(', ') : '')].join(' | ') + ' |');
    }
    L.push('');
    L.push('## Decisions');
    L.push('');
    for (const d of DECISIONS) {
      if (d.when && !d.when(j)) continue;
      const v = decision(j, d.key);
      const o = d.options.find((x) => x.value === v);
      L.push('- ' + d.title + ': ' + (o ? o.label : v) + (j.confirmed[d.key] ? '' : ' (not confirmed)'));
    }
    const lockC = value(j, 'CLG_LOCKOUT'), lockH = value(j, 'HP_LOCKOUT');
    L.push('- Cooling low-ambient lockout: ' + (lockC != null && lockC !== '' ? lockC + '°F' : 'not set'));
    L.push('- Heat pump heating lockout: ' + (lockH != null && lockH !== '' ? lockH + '°F' : 'not set'));
    const changed = VALUES.filter((v) => j.values[v.key] != null && j.values[v.key] !== '' && String(j.values[v.key]) !== String(v.def) && !v.ask);
    if (changed.length) {
      L.push('');
      L.push('Values changed from the office defaults:');
      for (const v of changed) L.push('- ' + v.label + ': ' + j.values[v.key] + ' (default ' + v.def + ')');
    }
    if (j.review && j.review.length) {
      L.push('');
      L.push('## Draft review findings');
      L.push('');
      for (const r of j.review) L.push('- ' + r.group + ': ' + r.text + (j.reviewNotes[r.text] ? ' Resolution: ' + j.reviewNotes[r.text] : ''));
    }
    const lc = libraryCheck(j, lib);
    const no = lc.filter((x) => x.answer === 'no');
    if (no.length) {
      L.push('');
      L.push('## Library points not used on ' + (j.code || 'this job'));
      L.push('');
      for (const x of no) L.push('- ' + x.type + ': ' + x.point.desc + ' (' + x.point.applies + ')');
    }
    const edited = Object.keys(j.overrides).length + Object.values(j.added).reduce((a, b) => a + b.length, 0);
    if (edited) { L.push(''); L.push('Sequence paragraphs written or edited by hand: ' + edited + '.'); }
    if (j.issued.length) {
      L.push('');
      L.push('## Issued revisions');
      L.push('');
      for (const i of j.issued) L.push('- Rev ' + i.rev + ', ' + i.date + ': ' + (i.changes || 'Issued.'));
    }
    const open = [...(j.openItems || []).filter((o) => !o.done).map((o) => o.text), ...engineeringChecks(j).map((e) => e.text)];
    L.push('');
    L.push('## Open items');
    L.push('');
    if (open.length) open.forEach((o) => L.push('- [ ] ' + o)); else L.push('- None.');
    if (j.log && j.log.length) {
      L.push('');
      L.push('## Notes');
      L.push('');
      j.log.forEach((x) => L.push('- ' + x.date + ': ' + x.text));
    }
    return L.join('\n') + '\n';
  }

  /** Files written at issue, named by job and revision. */
  function outputs(j, lib) {
    const seq = finalSequence(j);
    const rows = pointRows(j, lib);
    const base = (j.code || 'JOB') + ' ';
    const rev = j.revision ? ' REV ' + j.revision : '';
    const upd = libraryUpdate(j, lib);
    return [
      { name: base + 'SEQUENCE OF OPERATIONS' + rev + '.docx', data: docx(seq), kind: 'Sequence for Link Word Notes' },
      { name: base + 'SEQUENCE OF OPERATIONS' + rev + '.txt', data: utf8(sequenceText(seq)), kind: 'Sequence, plain text' },
      { name: base + 'DDC POINTS LIST' + rev + '.xlsx', data: xlsx(rows), kind: 'Points list for Link Excel Schedule' },
      { name: base + 'DECISION LOG' + rev + '.md', data: utf8(decisionLog(j, lib)), kind: 'Decision log' },
      { name: 'master_points_library.csv', data: utf8(libraryToCSV(upd.lib)), kind: 'Master library with this job\'s new points' },
    ];
  }

  const api = {
    TYPE_AHU, TYPE_CU, TYPE_GENERAL, SECTION_TITLE, DECISIONS, VALUES, VALUE_BY_KEY, POINTS_NOTES, ABBREVIATIONS,
    parseCSV, toCSV, loadLibrary, libraryToCSV, conditionsFor, sectionOf,
    newJob, newAhu, newUnit, ahuUnits, decision, openDecisions, value, fmtValue, usesHgrh, dehumActive, hasEsds,
    generateSequence, finalSequence, sequenceText, blanksIn, joinAnd, compressTags,
    unitPoints, pointRows, activeRows, jobTypes, libraryCheck, libraryUpdate,
    checkJob, engineeringChecks, reviewDraft,
    zip, crc32, utf8, docx, xlsx, decisionLog, outputs, clone, today,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SooEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
