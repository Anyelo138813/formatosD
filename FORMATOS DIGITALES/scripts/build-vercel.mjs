import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = resolve(root, 'dist');
const required = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY'];
const missing = required.filter((name) => !process.env[name]?.trim());

if (missing.length) {
  throw new Error(`Faltan variables de entorno para el despliegue: ${missing.join(', ')}`);
}

const supabaseUrl = process.env.SUPABASE_URL.trim();
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY.trim();
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(supabaseUrl)) {
  throw new Error('SUPABASE_URL no es una URL valida de Supabase.');
}
if (/service[_-]?role/i.test(publishableKey) || publishableKey.startsWith('sb_secret_')) {
  throw new Error('No uses una service_role/secret key en el frontend. Usa la publishable key.');
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const file of ['index.html', 'manifest.webmanifest', 'service-worker.js']) {
  await cp(resolve(root, file), resolve(output, file));
}
for (const directory of ['css', 'js', 'data', 'templates']) {
  await cp(resolve(root, directory), resolve(output, directory), { recursive: true });
}

const runtimeConfig = `// Generated during the Vercel build. Public browser configuration only.\n` +
  `globalThis.__APP_ENV__ = Object.freeze({\n` +
  `  SUPABASE_URL: ${JSON.stringify(supabaseUrl)},\n` +
  `  SUPABASE_PUBLISHABLE_KEY: ${JSON.stringify(publishableKey)}\n` +
  `});\n`;
await writeFile(resolve(output, 'env.js'), runtimeConfig, 'utf8');

console.log('Vercel bundle generated in dist/.');
