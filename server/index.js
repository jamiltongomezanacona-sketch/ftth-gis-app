import 'dotenv/config';
import http from 'node:http';
import { exec } from 'node:child_process';
import app, { pool } from './app.js';

const preferredPort = Number(process.env.PORT ?? 3000);
const maxPort = preferredPort + 25;

const server = http.createServer(app);

/**
 * Si el puerto preferido está ocupado (otra ventana con npm start), prueba el siguiente.
 */
function beginListen(port) {
  if (port > maxPort) {
    console.error(
      `\nNo hay puerto libre entre ${preferredPort} y ${maxPort}. Cierra la otra instancia o ejecuta: liberar-puerto-3000.bat\n`
    );
    process.exit(1);
    return;
  }

  const onError = (err) => {
    server.removeListener('error', onError);
    if (err.code === 'EADDRINUSE') {
      console.warn(`[puerto] ${port} ocupado · probando ${port + 1}…`);
      beginListen(port + 1);
    } else {
      console.error(err);
      process.exit(1);
    }
  };

  server.once('error', onError);
  server.listen(port, () => {
    server.removeListener('error', onError);
    const base = `http://127.0.0.1:${port}`;
    console.log(`FTTH GIS API ${base}`);
    if (port !== preferredPort) {
      console.log(
        `(El puerto ${preferredPort} estaba ocupado; usa la URL de arriba o cierra la otra ventana.)`
      );
    }
    console.log(
      '[api] POST /api/rutas · GET/POST /api/eventos-reporte · GET /api/centrales-etb · GET/POST /api/cierres · GET /api/db-check'
    );

    if (String(process.env.OPEN_BROWSER ?? '').toLowerCase() === '1') {
      const cmd =
        process.platform === 'win32'
          ? `start "" "${base}/"`
          : process.platform === 'darwin'
            ? `open "${base}/"`
            : `xdg-open "${base}/"`;
      exec(cmd, (err) => {
        if (err) console.warn('[OPEN_BROWSER]', err.message);
      });
    }
  });
}

beginListen(preferredPort);

process.on('SIGINT', async () => {
  await new Promise((resolve) => {
    server.close(() => resolve(undefined));
  });
  await pool.end();
  process.exit(0);
});
