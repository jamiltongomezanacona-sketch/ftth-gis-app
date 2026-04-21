import fs from 'node:fs';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createPool } from './db.js';
import { createRutasRouter } from './rutasRouter.js';
import { createCentralesRouter } from './centralesRouter.js';
import { createCierresRouter } from './cierresRouter.js';
import { createEventosReporteRouter } from './eventosReporteRouter.js';
import { createAuthRouter } from './authRouter.js';
import { insertRuta } from './rutasRepo.js';
import {
  MAX_LINE_VERTICES,
  MAX_NOMBRE_LEN,
  normalizeNombre,
  parseRedTipoObligatorio,
  isLineStringGeometry
} from './rutasShared.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const publicDir = path.join(rootDir, 'public');

const app = express();
const pool = createPool();

app.use(cors({ origin: true }));
app.use(express.json({ limit: '2mb' }));

app.use('/api/auth', createAuthRouter(pool));

/** Evita que proxy o navegador mezclen respuestas entre ?red=ftth y ?red=corporativa. */
app.use((req, res, next) => {
  const p = req.path;
  if (
    p.startsWith('/api/rutas') ||
    p.startsWith('/api/centrales-etb') ||
    p.startsWith('/api/cierres') ||
    p.startsWith('/api/eventos-reporte')
  ) {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Vary', 'X-Red-Tipo');
  }
  next();
});

/** POST /api/rutas (con o sin barra final). */
async function handlePostRuta(req, res, next) {
  try {
    const nombre = normalizeNombre(req.body?.nombre);
    if (!nombre) {
      res.status(400).json({ error: `nombre requerido (1–${MAX_NOMBRE_LEN} caracteres)` });
      return;
    }

    let geometry = req.body?.geometry;
    if (!geometry && req.body?.type === 'Feature') {
      geometry = req.body.geometry;
    }
    if (!isLineStringGeometry(geometry)) {
      res.status(400).json({
        error:
          'Se requiere geometry LineString con al menos 2 vértices válidos (lng,lat) y máximo ' +
          MAX_LINE_VERTICES
      });
      return;
    }

    const red = parseRedTipoObligatorio(req.body?.red);
    if (!red) {
      res.status(400).json({
        error:
          'Obligatorio en el JSON: "red": "ftth" o "red": "corporativa" (redes aisladas; no hay valor por defecto).'
      });
      return;
    }
    const created = await insertRuta(pool, nombre, geometry, red);
    if (!created) {
      res.status(500).json({ error: 'No se pudo crear la ruta' });
      return;
    }
    res.status(201).json({ ok: true, id: created.id, nombre: created.nombre });
  } catch (e) {
    if (e.code === '22P02' || e.message?.includes('parse')) {
      res.status(400).json({ error: 'Geometría no válida para PostGIS' });
      return;
    }
    next(e);
  }
}

app.post('/api/rutas', handlePostRuta);
app.post('/api/rutas/', handlePostRuta);

app.use('/api/rutas', createRutasRouter(pool));
app.use('/api/centrales-etb', createCentralesRouter(pool));
app.use('/api/cierres', createCierresRouter(pool));
/** Montaje anidado: evita 404 en algunos entornos donde `app.use('/api/eventos-reporte', r)` no enlaza POST/GET. */
const apiEventosWrap = express.Router();
apiEventosWrap.use('/eventos-reporte', createEventosReporteRouter(pool));
app.use('/api', apiEventosWrap);

/**
 * GeoJSON de respaldo (centrales) si la tabla está vacía: GET /data/centrales-etb.geojson
 * En Vercel los estáticos van en `public/` (CDN); en local también sirve `public/data` o la carpeta `data/` raíz.
 */
const publicDataDir = path.join(publicDir, 'data');
const rootDataDir = path.join(rootDir, 'data');
if (fs.existsSync(path.join(publicDataDir, 'centrales-etb.geojson'))) {
  app.use('/data', express.static(publicDataDir));
} else if (fs.existsSync(path.join(rootDataDir, 'centrales-etb.geojson'))) {
  app.use('/data', express.static(rootDataDir));
}

/**
 * Catálogo Flashfiber FTTH (carpeta externa, sin copiar al repo).
 * Define en .env: FLASHFIBER_FTTH_DIR=C:\ruta\flashfiber-ftth\public\geojson\FTTH
 * → archivos en http://127.0.0.1:3000/geojson/ftth/… (p. ej. moleculas-manifest.json).
 */
const flashfiberFtthDir = process.env.FLASHFIBER_FTTH_DIR
  ? path.resolve(process.env.FLASHFIBER_FTTH_DIR)
  : '';
const geojsonFtthStaticOpts = {
  etag: true,
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0
};

if (flashfiberFtthDir) {
  try {
    if (fs.existsSync(flashfiberFtthDir) && fs.statSync(flashfiberFtthDir).isDirectory()) {
      app.use('/geojson/ftth', express.static(flashfiberFtthDir, geojsonFtthStaticOpts));
      console.log(`[geojson] FTTH Flashfiber: GET /geojson/ftth/* → ${flashfiberFtthDir}`);
    } else {
      console.warn(`[geojson] FLASHFIBER_FTTH_DIR no es un directorio válido: ${flashfiberFtthDir}`);
    }
  } catch (e) {
    console.warn('[geojson] FLASHFIBER_FTTH_DIR:', e.message);
  }
}

/** Respaldo: manifiesto vacío y futuros GeoJSON versionados en repo (`public/geojson/ftth/`). */
const geojsonFtthFallbackDir = path.join(publicDir, 'geojson', 'ftth');
if (fs.existsSync(geojsonFtthFallbackDir)) {
  app.use('/geojson/ftth', express.static(geojsonFtthFallbackDir, geojsonFtthStaticOpts));
}

/** Evita 404: el navegador suele pedir /favicon.ico además del <link rel="icon">. */
app.get('/favicon.ico', (_req, res) => {
  res.type('image/svg+xml').sendFile(path.join(publicDir, 'favicon.svg'));
});

app.use(
  express.static(publicDir, {
    setHeaders(res, filePath) {
      const fp = filePath.replace(/\\/g, '/');
      if (fp.endsWith('.webmanifest')) {
        res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
      }
      if (fp.endsWith('.js') || fp.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-store, max-age=0');
      }
    }
  })
);

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

/** Comprueba conexión a PostgreSQL y existencia de la tabla `rutas` (diagnóstico). */
app.get('/api/db-check', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    const { rows: r0 } = await pool.query(
      `SELECT to_regclass('public.rutas') AS reg`
    );
    const rutasTable = Boolean(r0[0]?.reg);
    let rutasCount = null;
    /** @type {{ corporativa: number, ftth: number, otro?: number } | null} */
    let rutasByRed = null;
    if (rutasTable) {
      const { rows: r1 } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM rutas`
      );
      rutasCount = r1[0]?.n ?? 0;
      try {
        const { rows: r1b } = await pool.query(`
          SELECT
            COUNT(*) FILTER (WHERE r.red_tipo = 'corporativa')::int AS corporativa,
            COUNT(*) FILTER (WHERE
              r.red_tipo = 'ftth'
              OR r.red_tipo IS NULL
              OR trim(coalesce(r.red_tipo::text, '')) = ''
            )::int AS ftth,
            COUNT(*) FILTER (WHERE
              r.red_tipo IS DISTINCT FROM 'corporativa'
              AND r.red_tipo IS DISTINCT FROM 'ftth'
              AND r.red_tipo IS NOT NULL
              AND trim(coalesce(r.red_tipo::text, '')) <> ''
            )::int AS otro
          FROM rutas r
        `);
        rutasByRed = r1b[0] ?? null;
      } catch {
        rutasByRed = null;
      }
    }
    const { rows: r2 } = await pool.query(
      `SELECT to_regclass('public.centrales_etb') AS reg`
    );
    const centralesTable = Boolean(r2[0]?.reg);
    let centralesCount = null;
    if (centralesTable) {
      const { rows: r3 } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM centrales_etb`
      );
      centralesCount = r3[0]?.n ?? 0;
    }
    const { rows: r4 } = await pool.query(`SELECT to_regclass('public.cierres') AS reg`);
    const cierresTable = Boolean(r4[0]?.reg);
    let cierresCount = null;
    if (cierresTable) {
      const { rows: r5 } = await pool.query(`SELECT COUNT(*)::int AS n FROM cierres`);
      cierresCount = r5[0]?.n ?? 0;
    }
    res.json({
      ok: true,
      rutas_table: rutasTable,
      rutas_count: rutasCount,
      rutas_by_red: rutasByRed,
      centrales_etb_table: centralesTable,
      centrales_etb_count: centralesCount,
      cierres_table: cierresTable,
      cierres_count: cierresCount
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({
      ok: false,
      error: e.message,
      code: e.code
    });
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  /**
   * Por defecto se envía `detail` (mensaje PostgreSQL / Node) para depurar en local.
   * En internet público, pon HIDE_ERROR_DETAILS=1 en el entorno.
   */
  const hide = String(process.env.HIDE_ERROR_DETAILS ?? '').toLowerCase() === '1';
  res.status(500).json({
    error: 'Error interno del servidor',
    ...(!hide && { detail: err.message, code: err.code })
  });
});

export { pool };
export default app;
