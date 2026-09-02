import { readFile, writeFile } from 'node:fs/promises';

const configPath = new URL('../dist/server/wrangler.json', import.meta.url);
const config = JSON.parse(await readFile(configPath, 'utf8'));

config.name = 'chain-clash';
config.d1_databases = [{
  binding: 'DB',
  database_name: 'chain-clash-production',
  database_id: '3eb452f1-400d-43bf-97ab-9802b34d7c1d',
  migrations_dir: '../../drizzle',
}];

await writeFile(new URL('../dist/server/wrangler.production.json', import.meta.url), `${JSON.stringify(config, null, 2)}\n`);
