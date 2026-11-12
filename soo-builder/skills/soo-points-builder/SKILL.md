---
name: soo-points-builder
description: Review and write HVAC sequences of operations (SOO) and build the matching DDC points list, checked against the office master points library. Reads draft sequences, control diagrams, equipment schedules and old points lists from screenshots, PDFs, Excel or pasted text; runs the conflict, gap and cleanup review; asks the decisions that change control intent; then writes the sequence as a Word file for CAD Revit Link's Link Word Notes, the points list as an Excel file for Link Excel Schedule, a decision log, and the updated library. Use whenever the user wants to review, write, fix or condense a sequence of operations, build or check a DDC points list, or compare a points list with the master library, even if they do not say "skill".
---

# SOO and DDC points list builder

The rules live in one engine shared with the editor page. Do not restate or reinvent them; run the engine.

- Engine: `${CLAUDE_PLUGIN_ROOT}/app/engine.js`
- Command line builder: `node ${CLAUDE_PLUGIN_ROOT}/cli/build.mjs <job.json> [--library <csv>] [--out <folder>] [--check]`
- Seed library: `${CLAUDE_PLUGIN_ROOT}/library/master_points_library.csv` (use the office copy if the user names one)
- Sequence style reference: `${CLAUDE_PLUGIN_ROOT}/library/sequence_template_sz_cv_hp_ahu.txt`
- Full brief (review checks, style rules, engineering checks): `${CLAUDE_PLUGIN_ROOT}/BUILD_BRIEF.md`. Read Sections 5, 7 and 10 before a review.
- Example job file: `${CLAUDE_PLUGIN_ROOT}/examples/JOB-A.json`
- Editor page for the user: `${CLAUDE_PLUGIN_ROOT}/app/index.html` (opens in Edge or Chrome, no install)

## How to talk to the user

The user is a senior mechanical engineer. Plain English and HVAC words. No file paths, JSON, field names or code in what you say to them. No long dashes anywhere. Show the plan before a major task. Ask questions as multiple choice with the recommended option first, at most four per round, each one standing on its own. Push back when a choice has a code or performance problem, then respect the decision. Never invent schedule values, capacities or setpoints: ask.

## Workflow (strict order, the user signs off each stage)

1. **Read the inputs.** Screenshots and PDFs: read them yourself (vision). Pull from the schedules, per unit: tag, paired CU tag, compressor stages, electric heat stages, supply CFM, OA CFM, cooling MBH, smoke detector notes. From the diagrams: return temp and humidity sensors, override button, OA flow station, high static switch, condensate switch, smoke detectors, motorized OA damper. From the notes sheet: emergency HVAC shutdown switch text, water meter. Schedule values govern over the draft; flag every conflict.
2. **Review the draft.** Put the draft text in the job file's `draft` field and run the builder with `--check`; it prints the automatic findings. Then do your own pass against brief Section 5.2 for anything the pattern checks cannot see (meaning, not words). Report as three short groups: Conflicts, Gaps, Cleanup. Mention schematic sensors that the sequence never uses.
3. **Ask the decisions** the inputs do not answer (brief Section 5.1): dehumidification mode, reheat source, hot gas reheat valve on/off or modulating, outside air damper, emergency shutdown switch (hardwired or programmed, what it stops, which dampers it closes), override wording on government jobs, and the two lockout temperatures (always ask, keep them separate). List any new numbers for confirmation.
4. **Write the job file** (format below) and run the builder with `--check`. Fix every FIX line by asking or by correcting the job file. Show the sequence text in a copy/paste code block and the points list as a short table, with a short list of what changed and the open items.
5. **Library check.** The builder lists library points not on the job. Ask whether each applies (group them by equipment type). Record answers in `libAnswers` (`"yes"` or `"no"`, keyed exactly as `type|description|applies when`). For "yes", switch on the unit feature or condition that brings the point in (see below); add a row in `extraPoints` only when no feature covers it.
6. **Issue.** Set `revision` (A, then B, ...) and add an `issued` entry with the date and what changed. Run the builder without `--check` and `--out` set to the folder the user names. It writes the sequence (.docx and .txt), the points list (.xlsx), the decision log (.md) and the master library CSV with the job's new points tagged with the job code. The sequence, schematics and points list always carry the same revision letter; a change to one reissues all three.
7. Tell the user they can open the job file in the editor page to keep editing (Open, then pick the job file).

Schematic redlines are not built yet. If asked, say so and list the diagram changes as numbered notes instead.

## Job file format

```json
{
  "format": "soo-builder-job", "version": 1,
  "code": "JOB-B", "title": "", "government": true, "humid": true,
  "decisions": { "dehum": "full|compressor|monitor", "reheat": "hgrh|electric", "hgrhValve": "onoff|modulating",
                 "oaDamper": "mvd|motorized", "esds": "hardwired|programmed|none", "overrideTerm": "LOCAL OVERRIDE|LOCAL TENANT OVERRIDE" },
  "confirmed": { "dehum": true },
  "values": { "CLG_LOCKOUT": 20, "HP_LOCKOUT": 20 },
  "units": [
    { "id": "u1", "type": "Single-zone CV split heat pump AHU (HGRH, electric aux heat)", "tag": "AHU-1", "cu": "CU-1",
      "compStages": 1, "heatStages": 1, "cfm": 800, "oaCfm": 150, "coolingMbh": 24,
      "rat": true, "rh": true, "override": true, "oaFlow": true, "highStatic": true,
      "supplySd": false, "returnSd": false, "condOverflow": false },
    { "id": "u4", "type": "Exhaust fans", "tag": "EF-1,2", "conditions": { "Lights-interlocked fans": true } }
  ],
  "general": { "oat": true, "esdsDampers": ["OUTSIDE AIR INTAKE LOUVER", "EXHAUST LOUVER"], "waterMeter": false, "meterAlarm": false },
  "draft": "", "overrides": {}, "added": {}, "removed": {},
  "pointEdits": {}, "extraPoints": [], "libAnswers": {},
  "revision": "", "issued": [], "openItems": [{ "text": "Low-ambient kit confirmation.", "done": false }]
}
```

- `confirmed[key] = true` only after the user picked that decision. Unconfirmed decisions are flagged to fix.
- Values keys and office defaults are the `VALUES` list in the engine. Leave a value out to use the default. Lockouts have no default.
- Other equipment types and their conditions are the library's "equipment_type" and "applies_when" values, spelled exactly.
- `overrides["<item id>"] = { "text": "...", "base": "<generated text>" }` replaces one paragraph with the engineer's wording. Item ids look like `occ.2`, `comp.lockouts`, `alarm.1.b`. Prefer changing units, decisions and values over overriding text. Use `added["<section key>"]` for extra paragraphs.
- `extraPoints`: `{ "id", "section": "HVAC|PLUMBING|GENERAL", "equipment", "type", "desc", "point", "units", "trend", "alarm", "applies" }`. Points with no `libDesc` are added to the library at issue.

## Things to always flag (do not decide for the user)

ASHRAE 90.1 reheat limits by unit capacity, IMC 2,000 CFM return smoke detector threshold, low-ambient kit below about 40°F cooling lockout, unoccupied fan cycling with a manual OA damper, programmed vs hardwired shutdown wording on the notes sheet, relays for lights-interlocked exhaust fans. Always add "verify against the adopted edition" for code items. The builder prints most of these under Engineering; carry them into the open items.
