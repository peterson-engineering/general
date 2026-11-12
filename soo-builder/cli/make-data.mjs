// Rebuilds app/library-data.js from library/master_points_library.csv so the editor page
// can open the seed library without a server. Run: node cli/make-data.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const csv = readFileSync(join(here, '..', 'library', 'master_points_library.csv'), 'utf8');
writeFileSync(join(here, '..', 'app', 'library-data.js'),
  '// Generated from library/master_points_library.csv by cli/make-data.mjs. Do not edit by hand.\n' +
  'window.SOO_LIBRARY_CSV = ' + JSON.stringify(csv) + ';\n');
console.log('library-data.js written');
