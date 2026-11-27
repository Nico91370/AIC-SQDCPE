// Import du classeur Excel en ligne de commande :
//   npm run import:excel -- <fichier.xlsm> [--site "Nom du site"] [--replace]
// (L'import est aussi possible depuis l'application : Paramètres → Import Excel.)

import { pool } from '../server/db.ts';
import { migrate } from '../server/migrate.ts';
import { importWorkbook } from '../server/importer.ts';

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--site');
const siteName = args.includes('--site') ? args[args.indexOf('--site') + 1] : 'Site principal';
const replace = args.includes('--replace');
if (!file) {
  console.error('Usage : npm run import:excel -- <fichier.xlsm> [--site "Nom du site"] [--replace]');
  process.exit(1);
}

await migrate();
const stats = await importWorkbook(file, siteName, replace);
console.log(`Import terminé pour « ${siteName} » :`, stats);
await pool.end();
