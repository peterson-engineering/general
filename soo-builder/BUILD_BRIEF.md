# SOO and DDC Points List Builder: Build Brief

This brief is for Claude Code. It describes a tool that helps a mechanical engineer review and write HVAC sequences of operations (SOO), mark up control schematics, and build DDC points lists that all agree with each other. Everything here comes from a completed real-world run of this workflow, generalized so it applies to any project.

Companion files in this folder:

- `master_points_library.csv`: seed data for the master DDC points library (Appendix B in table form).
- `sequence_template_sz_cv_hp_ahu.txt`: a finished generic sequence for one system type (Appendix A), used as the first library entry and as a style reference.

---

## 1. Users and goal

- **User:** A senior mechanical project engineer (HVAC and plumbing) who writes sequences and points lists for design drawings, often for government and military facilities. Drafters put the output into CAD.
- **Goal:** Take a draft sequence, control diagrams, and equipment schedules, then produce a corrected sequence, schematic redlines, and a points list. All three must agree point for point, and every job gets checked against a growing master points library so nothing is missed.

## 2. Core workflow (strict order)

The tool must work in this order and not skip ahead. The user signs off on each stage before the next starts.

1. **Sequence.** Review the draft SOO, list conflicts and gaps, ask the decisions that change control intent, then issue a clean revision.
2. **Schematics.** Mark up each control diagram so every device and point the sequence uses is shown, and nothing is shown that the sequence does not use.
3. **Points list.** Build it from the final sequence and schematics, on the user's Excel template.
4. **Master library check.** Compare the points list against the master library for every equipment type on the job. Flag missing points and ask whether they apply.
5. **Master library update.** After issue, add new equipment types and new points to the library with a source tag (a neutral job code the user supplies).
6. **Job record.** Save the final sequence, points list, and a decision log per job.

Revision rule: the sequence, schematics, and points list always carry the same revision letter. A change to one reissues all three.

## 3. Inputs

| Input | Typical form | Notes |
|---|---|---|
| Draft sequence | Screenshot of a CAD sheet, PDF, or pasted text | All caps, numbered sections |
| Control diagrams | Screenshot or PDF, one diagram per unit | Usually "typical" for several units with small differences |
| Existing points list | Screenshot or Excel | Often out of sync with the sequence |
| Equipment schedules | Screenshots or Excel | AHU, condensing unit, mini split, fan, water heater schedules. Source for CFM, OA CFM, capacity, stages, kW, smoke detector notes |
| Points list template | User's .xlsx | Must be filled, not replaced (Section 7) |
| Control notes sheet | Screenshot | General notes, water meter, emergency shutdown switch text |
| User answers | Multiple choice plus free text | Section 5.1 |

Image inputs need OCR or a vision model. Treat any schedule value as authoritative over the draft sequence and flag conflicts.

## 4. Outputs

1. **Sequence:** a plain text file plus the same text in a copy/paste code block. ALL CAPS, ready to paste into CAD.
2. **Schematic redlines:** a PDF with one page per diagram. Each page holds the original image scaled 2x, red numbered circle tags with leader lines to the affected device, and a red numbered note list below the diagram. CAD files cannot be edited, so redlines are the deliverable.
3. **Points list:** the user's Excel template, filled in (Section 7).
4. **Decision log:** markdown with equipment summary, decisions, issued revisions, and open items.
5. **Review report** (chat text): conflicts, gaps, and questions, grouped and kept short.

## 5. Stage 1: Sequence review and writing

### 5.1 Decisions the tool must ask before rewriting

Ask these as multiple choice with a recommended option first. Ask only what the inputs do not already answer.

| Decision | Options | Recommended default |
|---|---|---|
| Compressor and electric heat stages, per unit | 1/1, 2/2, mixed, not selected yet | Read from schedule. Units in one "typical" sequence can differ |
| Cooling control strategy (single-zone CV) | Zone temperature control with coil low limit; fixed supply air temperature with reheat | Zone temperature control |
| Dehumidification | Full mode with reheat; compressor only with zone low limit; monitor and alarm only | Full mode, if a humidity sensor exists or the climate is humid |
| Reheat source | Hot gas reheat; electric reheat; none | Hot gas reheat (avoids energy code reheat limits) |
| Outside air damper | Manual volume damper only; add two-position motorized damper | Ask. If manual only, remove any "dampers shall close" language |
| Lockout setpoints | Cooling low-ambient, heat pump heating lockout | Ask. Keep them as two separate setpoints |
| Smoke detectors per unit | None, supply, return, both | From schedule notes and CFM (Section 10) |
| Emergency HVAC shutdown switch | What it stops, what dampers it closes, hardwired or programmed | Hardwired, BAS monitors only |
| Hot gas reheat valve | On/off or modulating | Ask. Sets DO vs AO on the points list |
| New numeric values the tool proposes | Confirm or change | Always list proposed numbers for confirmation |

### 5.2 Review checks (things that went wrong in real drafts)

The tool should run these checks on any draft sequence and report hits as Conflicts, Gaps, or Cleanup.

**Conflicts**

- The General section says the unit controls to zone temperature, but Occupied mode holds a fixed SAT.
- Electric heat is used to hold the cooling setpoint, which means reheat.
- Electric heat is used as first-stage heat in some modes when a heat pump is supposed to be primary.
- One lockout value is used for both the cooling low-ambient lockout and the heat pump heating lockout.
- A compressor lockout prevents the supply fan from starting. It should block only the compressor.
- Enable logic says "ALL of the following" and then lists conditions joined by "OR".
- Text says "staged" or "interstage delay" where the schedule shows single stage.
- Text says "all dampers shall close" where no motorized damper exists.
- A contactor-staged heater is described as "modulating".
- A cross-reference names a section that does not exist.
- One device goes by several names, such as "reheat element", "electric heater", and "auxiliary heat".

**Gaps**

- A sensor on the schematic is not used in the sequence. A return humidity sensor with no dehumidification mode is the common case.
- No dehumidification mode in a humid climate, occupied or unoccupied.
- An emergency HVAC shutdown switch appears on the notes sheet but not in the sequence.
- Defrost is not addressed. The factory controller handles it; the BAS monitors it and tempers supply air with auxiliary heat.
- Smoke detector shutdown is not stated as hardwired and independent of the BAS.
- Override duration is undefined.
- No coil low limit.
- The alarm list is missing smoke, emergency shutdown, high humidity, zone temperature deviation, or low outside airflow.
- An OA flow station is shown but never used.

**Cleanup**

- Garbled minimum on/off time wording.
- Typos carried from older lists, such as "STOP/STOP".
- Commercial terms like "tenant" on government jobs. Ask the user before changing.

### 5.3 Sequence style rules

- ALL CAPS. Numbered items. Lettered sub-items (A., B., C.) for lists of conditions.
- Use "SHALL". Use "BAS", never "BMS". Use "OCCUPIED MODE" and "UNOCCUPIED MODE".
- Every setpoint, limit, and time delay is followed by "(ADJ.)".
- No em dashes anywhere.
- Header line format: `[SYSTEM TYPE] - [KEY FEATURES] - SEQUENCE OF OPERATIONS`, plus a "TYPICAL FOR ..." line.
- Section order: GENERAL, CONTROL SYSTEM, OPERATING MODES, STARTUP SEQUENCE, OCCUPIED MODE, COMPRESSOR CONTROL, AUXILIARY ELECTRIC HEAT CONTROL, DEHUMIDIFICATION CONTROL, UNOCCUPIED MODE, SHUTDOWN SEQUENCE, SAFETIES AND INTERLOCKS, ALARMS AND NOTIFICATIONS.
- Dehumidification is its own section and is referenced from the modes.
- Name a heat pump indoor coil "DX/HP COIL". It cools and heats. The coil low limit applies in cooling and dehumidification only.
- Where units in a typical sequence differ, say so in General (for example, "AHU-1 AND AHU-2: SINGLE STAGE. AHU-3: TWO STAGE").

### 5.4 Condensing rules (the user wants short sequences)

These cut a first draft by roughly 25 to 30 percent with no loss of control intent:

1. Replace the monitored-points list with: "THE BAS SHALL MONITOR AND TREND ALL POINTS LISTED ON THE DDC POINTS LIST."
2. Replace simple alarms with: "THE BAS SHALL GENERATE ALARMS FOR ALL POINTS MARKED IN THE ALARM COLUMN OF THE DDC POINTS LIST, AND FOR THE FOLLOWING:". Keep only alarms that need logic or timing: zone temperature deviation, high humidity, low outside airflow, damper failure, sensor failure.
3. State the staging rule once in General, then say "stage the compressor" elsewhere.
4. Merge cooling and heat pump heating into one COMPRESSOR CONTROL section.
5. Write each interlock once. Group hardwired shutdowns (smoke detector, emergency shutdown switch, high static) under one item.

Before condensing, verify that every dropped alarm and monitored point exists on the points list with the right Alarm flag. After condensing, the sequence depends on the points list, so they must always be issued together.

## 6. Stage 2: Schematic redlines

### 6.1 Method

- Crop each diagram from the source image and scale it 2x.
- Draw red numbered circle tags. A tag gets a leader line and dot when it points at a device; general notes get no leader.
- Below the diagram, add a red panel titled `<UNIT> CONTROL DIAGRAM MARKUP (REV x SEQUENCE)` with numbered notes matching the tags.
- Use one note list template per system type, filled per unit (CU tag, stages, smoke detectors).
- Coordinates must be set per diagram. Typical diagrams are not pixel-identical. Render the result and check it visually before issuing.

### 6.2 Standard checks for a split heat pump AHU diagram

1. Hot gas reheat coil shown downstream of the DX/HP coil, upstream of the fan, with piping from the CU.
2. Condensing unit shown with its points: compressor start/stop and status per stage, reversing valve, HGRH command and status, defrost status, refrigerant pressure fault.
3. Sensors labeled to match the points list: RAT, RA RH, MAT, DX/HP LAT, DAT. The DX/HP LAT sensor must sit between the DX/HP coil and the HGRH coil.
4. Zone temperature sensor with override button shown.
5. Electric heat: command and status per stage, high limit status, and a hardwired interlock to fan proof of flow.
6. Outside air temperature noted as a global building point if no sensor is drawn.
7. Hardwired shutdown note: emergency shutdown switch and high static switch stop the fan, compressor, HGRH, and electric heat.
8. Smoke detectors match the schedule and code. Each has a DI to the BAS for monitoring; fan shutdown is through the fire alarm.

## 7. Stage 3: Points list

### 7.1 Template format (match exactly)

- Title row: "Equipment Schedule Points List" (merged A:F).
- Header row: Equipment | POINT DESCRIPTIONS | POINT | UNITS | TREND | ALARM.
- Borders: medium on the outer left and right and the bottom of the table; thin elsewhere. Points columns centered.
- Section header rows in bold: `HVAC SYSTEMS:`, `PLUMBING SYSTEMS:`, `GENERAL BUILDING SYSTEMS:`.
- If the table outgrows the template rows, rebuild the rows and move the notes block down. Do not overwrite the notes.
- Notes block below the table, verbatim:
  1. ALARM SHALL BE GENERATED IF BINARY PROOF ≠ BINARY COMMAND SET TO 'ON' PLUS TWO POLLING INTERVALS (NO LESS THAN ONE MINUTE INTERVALS).
  2. ALL SETPOINTS, ALARM LIMITS, AND TIME DELAYS INDICATED AS (ADJ.) IN THE SEQUENCE OF OPERATIONS SHALL BE ADJUSTABLE AT THE DDC SYSTEM.
  3. DDC SHALL DISPLAY ALL STAGES OF HEAT.
  4. WHERE MULTIPLE EQUIPMENT TAGS ARE LISTED ON A SINGLE ROW, THE POINTS INDICATED SHALL BE PROVIDED FOR EACH UNIT LISTED. QUANTITIES SHOWN ARE PER UNIT, TYPICAL.
- Abbreviations: AI - ANALOG INPUT, AO - ANALOG OUTPUT, DI - DIGITAL INPUT, DO - DIGITAL OUTPUT, AV - ANALOG VALUE.
- Print setup: fit to one page wide.

### 7.2 Row rules

- Group identical units on one row ("AHU-1,2,3"). Give per-unit differences their own rows ("AHU-3" for stage 2 points, "AHU-2,3" for supply smoke detector).
- Use DI/DO, never BI/BO.
- Units vocabulary: ON/OFF, OFF/ON (override), OK/ALARM, OK/FAULT, OK/REPLACE, HEAT/COOL, COOL/HEAT, OPEN/CLOSED, START/STOP, AUTO/HAND, °F, %RH, %, CFM, GPM, GALLONS, PSI, IN. W.G.
- Trend: X on every point by default.
- Alarm: X on safeties, faults, proof points (command/status mismatch), key sensors (zone temp, RH, DAT, coil LAT, OA flow), smoke, emergency shutdown, damper end switches, meters.
- Order within a unit: space and setpoints, return, mixed, OA, filter, coil, fan, electric heat, discharge, smoke. Condensing unit rows follow their AHU rows.

### 7.3 Sequence feature to points mapping (drives automatic generation)

| Sequence feature | Points it requires |
|---|---|
| Zone temperature control | Zone temp AI, cooling setpoint AV, heating setpoint AV |
| Local override | Override DI |
| Dehumidification | Return or zone RH AI, RH setpoint AV |
| OA flow station | OA airflow AI, OA airflow setpoint AV |
| Coil low limit | Coil leaving air temp AI |
| Discharge air high limit | Discharge air temp AI |
| Supply fan | Start/stop DO, status DI |
| Each electric heat stage | Stage command DO, stage status DI |
| Electric heat | High limit status DI |
| Each compressor stage | Start/stop DO, status DI |
| Heat pump | Reversing valve DO, defrost status DI |
| Hot gas reheat | HGRH command DO (AO if modulating), HGRH status DI |
| Refrigerant safeties | HP/LP fault DI |
| Filter alarm | Filter DPS DI |
| High static switch | High static DI |
| Duct smoke detector | Smoke detector DI per detector |
| Emergency HVAC shutdown switch | Switch status DI; damper end switch DI per damper group |
| Outside air lockouts | Outside air temp AI (global point) |

## 8. Stage 4: Master library

- One library organized by equipment type, not by job. Columns: Point description | Point | Units | Trend | Alarm | Applies when | Source.
- **Applies when** states the configuration that needs the point (for example, "one per stage", "condensate pump provided", "VFD pump").
- **Source** holds neutral job codes the user assigns. No client, base, or building names.
- Never delete points. Mark "not used on <job>" in that job's log.
- **Check:** for each equipment type on the job, list library points missing from the job list and ask the user whether each applies.
- **Update:** add new points, new equipment types, and new "Applies when" conditions after issue.

## 9. Suggested data model

```
EquipmentType   id, name, section (HVAC | PLUMBING | GENERAL)
LibraryPoint    equipment_type_id, description, point_type (AI|AO|DI|DO|AV),
                units, trend (bool), alarm (bool), applies_when, sources[]
Job             code, units[], decisions{}, revision_letter
Unit            tag, equipment_type_id, features{stages_comp, stages_heat,
                hgrh, hgrh_modulating, supply_sd, return_sd, oa_flow_station,
                motorized_oa_damper, rh_sensor, cfm, oa_cfm, cooling_mbh, ...}
SequenceTemplate system_type, sections[] with placeholders and feature switches
```

Generate points from the unit features through the 7.3 mapping, then group units with identical point sets onto shared rows.

## 10. Engineering checks to build in

Flag these for the engineer to confirm. Do not hard-code them as law. Code editions vary by jurisdiction, so always say "verify against the adopted edition."

- **Reheat for dehumidification:** ASHRAE 90.1 Section 6.5.2.3 limits new-energy reheat. Exceptions as generally written:
  - Units of 40,000 Btu/h or less.
  - Units of 80,000 Btu/h or less that unload to 50% before reheat.
  - At least 75% of reheat energy site-recovered (hot gas reheat qualifies).
  - Spaces with specific humidity requirements.

  Check each unit's scheduled cooling capacity. Units over 80 MBH with electric reheat need hot gas reheat or no-reheat dehumidification. When hot gas reheat exists, write "ELECTRIC HEAT SHALL NOT BE USED FOR DEHUMIDIFICATION REHEAT."
- **Smoke detectors:** compare scheduled CFM to the IMC 2,000 CFM return detector threshold, the AHU schedule notes, and the fire alarm drawings. Flag mismatches between schedule notes and diagrams.
- **Cooling at low outdoor temperatures:** a cooling lockout below about 40°F usually needs a low-ambient kit on the condensing unit. Flag it.
- **Manual OA damper only:** unoccupied fan cycling brings in humid outside air. Flag it once, then respect the user's call.
- **Emergency shutdown switch:**
  - Confirm the list of equipment it stops.
  - Confirm the dampers it closes.
  - Check whether the notes sheet says "programmed" while the sequence says "hardwired".
  - Lights-interlocked exhaust fans need a relay to be stopped by it.
- **Every schematic sensor must appear in the sequence and on the points list, and the reverse.** Run this as an automatic three-way cross-check.

## 11. Interaction rules

- Show the plan before starting a major task.
- Ask clarifying questions before detailed answers. Use multiple choice with a recommended option first, at most four questions per round. Each question must stand alone without earlier context.
- Plain English and HVAC vocabulary. No software jargon, file paths, or JSON in user-facing text.
- No em dashes in any output.
- Be direct and honest. Push back when a choice has a code or performance problem, then respect the decision.
- When proposing new numbers (limits, deadbands, delays), list them for confirmation instead of assuming.
- After each revision, give a short list of what changed and the open items.

## 12. Acceptance tests

1. Given the draft sequence in Appendix C, the review flags every item in Section 5.2 that applies.
2. Every point in the generated points list traces to a sequence feature or schematic device, and every sequence feature has its points (7.3 mapping).
3. The condensed sequence passes check 2 with the alarm and monitor lists removed.
4. The Excel output opens on the user's template with borders, notes, and abbreviations intact, and fits one page wide.
5. The redline PDF has one page per unit with tags placed on the right devices (visual check).
6. The master library check lists missing points per equipment type, and the update adds new points with the job code.
7. No output contains an em dash, "BMS", or BI/BO.

---

## Appendix A: Generic sequence example

The full text is in `sequence_template_sz_cv_hp_ahu.txt`. System: single-zone constant volume AHU with split heat pump condensing unit, hot gas reheat, and electric auxiliary heat. Three units, two single-stage and one two-stage. About 1,460 words after condensing. Use it as the first library sequence and as the style reference.

Default values used (all ADJ.):

| Item | Value |
|---|---|
| Occupied cooling / heating | 75°F / 68°F |
| Minimum deadband | 2°F |
| Unoccupied cooling / heating | 80°F / 65°F |
| Unoccupied recovery band | 2°F inside setpoint |
| Compressor on/off differential | 1°F |
| Staging trigger | 1.5°F from setpoint for 10 minutes |
| Compressor interstage delay | 3 minutes |
| Electric heat interstage delay | 1 minute |
| Compressor minimum on / off | 3 / 5 minutes |
| Cooling / heating changeover delay | 5 minutes |
| Coil low limit | 45°F off, 50°F on (cooling and dehumidification) |
| Cooling low-ambient lockout / heat pump heating lockout | 20°F / 20°F (project-specific, always ask) |
| Electric heat off | Within 0.5°F of heating setpoint |
| Discharge air high limit | 95°F |
| Occupied dehumidification | On at 60% RH, off at 55% |
| Unoccupied dehumidification | On at 65% RH, off at 60% |
| HGRH target | Midpoint between active heating and cooling setpoints |
| Override duration | 2 hours |
| Fan proof of flow timeout | 60 seconds |
| Electric heat purge | 60 seconds |
| Zone temp alarm | 5°F from setpoint for 15 minutes |
| High RH alarm | Above 65% for 60 minutes |
| Low OA flow alarm | 20% below design for 15 minutes |
| Emergency damper alarm | Not closed within 60 seconds |

## Appendix B: Master points library (seed)

Full data is in `master_points_library.csv`. Equipment types included:

1. Single-zone CV split heat pump AHU (HGRH, electric auxiliary heat)
2. Split heat pump condensing unit
3. Mini split indoor unit
4. Mini split condensing unit
5. Exhaust fans (lights interlock, continuous, BAS scheduled, smoke exhaust)
6. Chilled water AHU (VAV system)
7. VAV terminal with electric reheat
8. Chilled water pumps and loop
9. Heating (unit heaters, monitored spaces)
10. Plumbing (water heater, recirculation, booster pumps, sump pumps)
11. General building (OA temp, emergency shutdown switch, emergency dampers, water meter)

Source codes in the seed: `JOB-A` for points designed in the example run, `REF` for points taken from a reference list the user supplied.

## Appendix C: Worked example (generalized)

Use this as a regression test.

**Starting point:** a draft "single zone CV heat pump AHU" sequence typical for three units, three control diagrams, and an old points list. Findings:

1. Fixed 58°F SAT with electric heat holding the cooling setpoint. Changed to zone temperature control with a coil low limit.
2. Electric heat used before the heat pump in occupied and unoccupied modes. Changed to heat pump primary, electric heat auxiliary.
3. One 20°F value used for both lockouts; low-ambient lockout blocked fan start. Split into two lockouts that block only the compressor.
4. "ALL of the following" with OR conditions. Changed to "ANY ONE OF".
5. "Staged" text on single-stage units. Schedule showed two units at 1/1 and one at 2/2; written per unit.
6. "All dampers shall close" with only a manual damper. Removed. Low-leakage dampers at the building louvers, closed only by the emergency shutdown switch, added later.
7. Return humidity sensor unused. Added a dehumidification mode. The engineer later said all units had hot gas reheat, so HGRH became the reheat and electric heat was barred from dehumidification. The largest unit at 130 MBH would otherwise have failed the 90.1 reheat exceptions.
8. Emergency shutdown switch on the notes sheet but not in the sequence. Added as a hardwired shutdown with BAS monitoring.
9. Smoke detectors inconsistent across diagrams. Resolved per unit: the smallest unit (800 CFM) has none, the mid unit has supply, the large unit (4,000 CFM) has supply and return. The schedule note listed supply only, so the schedule was flagged for update.
10. Old points list had DX cooling points but no CU, HGRH, or OA flow points, a "STOP/STOP" typo, and column-shifted rows. Rebuilt from the sequence.
11. Sequence condensed from about 2,000 words to about 1,460 using Section 5.4.
12. Indoor coil relabeled "DX/HP COIL".

**Open items typical at the end of a job** (the tool should track them in the decision log):

- Low-ambient kit confirmation.
- Schedule note updates.
- Notes sheet wording, programmed vs hardwired.
- Relay coordination for lights-interlocked fans.
- Whether a General section line about outside air stays.
