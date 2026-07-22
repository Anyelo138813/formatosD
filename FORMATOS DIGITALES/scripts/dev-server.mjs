import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const host = '127.0.0.1';
const port = Number(process.env.PORT || 4173);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
]);

function safePath(url) {
  const pathname = decodeURIComponent(new URL(url, `http://${host}:${port}`).pathname);
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  if (relative.startsWith('.') || relative.includes('..') || relative.startsWith('node_modules/')) return null;
  const resolved = path.resolve(root, relative);
  return resolved.startsWith(`${root}${path.sep}`) ? resolved : null;
}

const server = http.createServer(async (request, response) => {
  try {
    let target = safePath(request.url || '/');
    if (!target) throw Object.assign(new Error('Not found'), { code: 'ENOENT' });
    if ((await stat(target)).isDirectory()) target = path.join(target, 'index.html');
    const content = await readFile(target);
    response.writeHead(200, {
      'Content-Type': mimeTypes.get(path.extname(target).toLowerCase()) || 'application/octet-stream',
      'Cache-Control': 'no-store, max-age=0',
    });
    response.end(content);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(error.code === 'ENOENT' ? 'Archivo no encontrado' : 'Error del servidor local');
  }
});

server.on('error', error => {
  if (error.code === 'EADDRINUSE') console.error(`El puerto ${port} ya está ocupado. Cierra el servidor anterior e intenta de nuevo.`);
  else console.error(error);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`Interfaz disponible en http://${host}:${port}`);
  console.log('Mantén esta ventana abierta. Presiona Ctrl+C para detenerla.');
});
