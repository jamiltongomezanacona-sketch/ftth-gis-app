import { Router } from 'express';
import {
  fetchRutasAsFeatureCollection,
  fetchRutaFeatureById,
  updateRutaGeometry
} from './rutasRepo.js';
import {
  MAX_LINE_VERTICES,
  MAX_NOMBRE_LEN,
  normalizeNombre,
  isLineStringGeometry,
  redTipoDesdePeticionLectura
} from './rutasShared.js';

/**
 * @param {import('pg').Pool} pool
 * @param {{ requireBearerAuth: import('express').RequestHandler }} opts
 */
export function createRutasRouter(pool, opts) {
  const { requireBearerAuth } = opts;
  const r = Router();

  /** GET /api/rutas?red=ftth|corporativa — FeatureCollection */
  r.get('/', async (req, res, next) => {
    try {
      const rRed = redTipoDesdePeticionLectura(req);
      if (!rRed.ok) {
        res.status(400).json({ error: rRed.error });
        return;
      }
      const fc = await fetchRutasAsFeatureCollection(pool, rRed.red);
      res.json(fc);
    } catch (e) {
      next(e);
    }
  });

  /** GET /api/rutas/:id?red=… — Feature única */
  r.get('/:id', async (req, res, next) => {
    try {
      const rRed = redTipoDesdePeticionLectura(req);
      if (!rRed.ok) {
        res.status(400).json({ error: rRed.error });
        return;
      }
      const red = rRed.red;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) {
        res.status(400).json({ error: 'id inválido' });
        return;
      }
      const feature = await fetchRutaFeatureById(pool, id, red);
      if (!feature) {
        res.status(404).json({ error: 'Ruta no encontrada' });
        return;
      }
      res.json(feature);
    } catch (e) {
      next(e);
    }
  });

  /**
   * PUT /api/rutas/:id
   * Body: { "geometry": { "type":"LineString", "coordinates": [...] } }
   *   o Feature completa: { "type":"Feature", "geometry": {...} }
   */
  r.put('/:id', requireBearerAuth, async (req, res, next) => {
    try {
      const rRed = redTipoDesdePeticionLectura(req);
      if (!rRed.ok) {
        res.status(400).json({ error: rRed.error });
        return;
      }
      const red = rRed.red;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) {
        res.status(400).json({ error: 'id inválido' });
        return;
      }

      const body = req.body;
      let geometry = body?.geometry;
      if (!geometry && body?.type === 'Feature') {
        geometry = body.geometry;
      }
      if (!isLineStringGeometry(geometry)) {
        res.status(400).json({
          error:
            'Se requiere geometry LineString con al menos 2 vértices válidos (lng,lat) y máximo ' +
            MAX_LINE_VERTICES
        });
        return;
      }

      const updated = await updateRutaGeometry(pool, id, geometry, red);
      if (!updated) {
        res.status(404).json({ error: 'Ruta no encontrada' });
        return;
      }

      res.json({ ok: true, id: updated.id, nombre: updated.nombre });
    } catch (e) {
      if (e.code === '22P02' || e.message?.includes('parse')) {
        res.status(400).json({ error: 'Geometría no válida para PostGIS' });
        return;
      }
      next(e);
    }
  });

  return r;
}
