#!/usr/bin/env node
// Command line builder used by the Claude skill. Same engine as the editor page.
//   node cli/build.mjs <job.json> [--library <master_points_library.csv>] [--out <folder>] [--check]
// --check prints the review and checks only. Without it, the files are written to --out (default: beside the job file).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const here = dirname(fileURLToPath(import.meta.url));
const E = createRequire(import.meta.url)(join(here, '..', 'app', 'engine.js'));

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const jobPath = args.find((a, i) => !a.startsWith('--') && !['--library', '--out'].includes(args[i - 1]));
if (!jobPath) { console.error('Usage: node cli/build.mjs <job.json> [--library lib.csv] [--out folder] [--check]'); process.exit(2); }
const job = Object.assign(E.newJob(), JSON.parse(readFileSync(jobPath, 'utf8')));
const lib = E.loadLibrary(readFileSync(opt('--library') || join(here, '..', 'library', 'master_points_library.csv'), 'utf8'));

if (job.draft && (!job.review || !job.review.length)) job.review = E.reviewDraft(job.draft, job);
const checks = E.checkJob(job, lib);
const lc = E.libraryCheck(job, lib);
const say = (s) => process.stdout.write(s + '\n');
if (job.review && job.review.length) {
  say('DRAFT REVIEW');
  for (const g of ['Conflict', 'Gap', 'Cleanup']) for (const r of job.review.filter((x) => x.group === g)) say('  ' + g + ': ' + r.text + (r.quote ? '  [' + r.quote + ']' : ''));
}
say('CHECKS');
for (const c of checks) say('  ' + c.level.toUpperCase() + ' ' + c.area + ': ' + c.text);
if (!checks.length) say('  none');
say('LIBRARY POINTS NOT ON THE LIST');
for (const m of lc) say('  ' + (m.answer || 'unanswered') + ' ' + m.type + ': ' + m.point.desc + ' (' + m.point.applies + ')');
if (!lc.length) say('  none');
if (args.includes('--check')) process.exit(0);
const out = resolve(opt('--out') || dirname(jobPath));
mkdirSync(out, { recursive: true });
for (const f of E.outputs(job, lib)) { writeFileSync(join(out, f.name), f.data); say('WROTE ' + join(out, f.name)); }
