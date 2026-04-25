import { Router } from 'express';
import { buildMoleculaCodigoVariants } from './cierresRouter.js';
import {
  deleteEventoReporteById,
  insertEventoReporte,
  listEventosReporteForRed,
  updateEventoReporteById
} from './eventosReporteRepo.js';
import { queryStringParam, redTipoDesdePeticionLectura } from './rutasShared.js';

const TIPOS = new Set([
  'VANDALISMO',
  'OBRAS CIVILES',
  'DETERIORO',
  'MANTENIMIENTO',
  'DAÑO POR TERCEROS'
]);

const ESTADOS = new Set(['CRITICO', 'EN PROCESO', 'RESUELTO', 'PENDIENTE', 'ESCALADO']);

const ACCIONES = new Set([
  'REEMPLAZO DE FIBRA',
  'SE INSTALA CIERRE',
  'INTERVENCIÓN TECNICA',
  'INTERVENCION TECNICA'
]);

const MAX_DESC = 8000;

/**
 * @param {import('pg').Pool} pool
 * @param {{ requireBearerAuth: import('express').RequestHandler }} opts
 */
export function createEventosReporteRouter(pool, opts) {
  const { requireBearerAuth } = opts;
  const r = Router();

  r.delete('/:id', requireBearerAuth, async (req, res, next) => {
    try {
      const rRed = redTipoDesdePeticionLectura(req);
      if (!rRed.ok) {
        res.status(400).json({ error: rRed.error });
        return;
      }
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) {
        res.status(400).json({ error: 'id inválido' });
        return;
      }
      const { deleted } = await deleteEventoReporteById(pool, rRed.red, id);
      if (!deleted) {
        res.status(404).json({ error: 'Evento no encontrado' });
        return;
      }
      res.status(200).json({ ok: true, deleted: true });
    } catch (e) {
      next(e);
    }
  });

  r.patch('/:id', requireBearerAuth, async (req, res, next) => {
    try {
      const rRed = redTipoDesdePeticionLectura(req);
      if (!rRed.ok) {
        res.status(400).json({ error: rRed.error });
        return;
      }
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) {
        res.status(400).json({ error: 'id inválido' });
        return;
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      /** @type {Record<string, unknown>} */
      const patch = {};

      if (Object.prototype.hasOwnProperty.call(body, 'tipo_evento')) {
        const tipo_evento = String(body.tipo_evento ?? '')
          .trim()
          .toUpperCase();
        if (!TIPOS.has(tipo_evento)) {
          res.status(400).json({ error: 'tipo_evento no válido' });
          return;
        }
        patch.tipo_evento = tipo_evento;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'estado')) {
        const estado = String(body.estado ?? '')
          .trim()
          .toUpperCase();
        if (!ESTADOS.has(estado)) {
          res.status(400).json({ error: 'estado no válido' });
          return;
        }
        patch.estado = estado;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'accion')) {
        let accion = String(body.accion ?? '').trim();
        if (accion.toUpperCase() === 'INTERVENCION TECNICA') {
          accion = 'INTERVENCIÓN TECNICA';
        }
        if (!ACCIONES.has(accion)) {
          res.status(400).json({ error: 'accion no válida' });
          return;
        }
        patch.accion = accion;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'descripcion')) {
        const descripcion = String(body.descripcion ?? '').trim().slice(0, MAX_DESC);
        if (!descripcion) {
          res.status(400).json({ error: 'descripcion no puede quedar vacía' });
          return;
        }
        patch.descripcion = descripcion;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'dist_odf')) {
        patch.dist_odf = body.dist_odf;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'nombre_tendido')) {
        patch.nombre_tendido = body.nombre_tendido;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'ruta_id')) {
        patch.ruta_id = body.ruta_id;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'lng') && Object.prototype.hasOwnProperty.call(body, 'lat')) {
        patch.lng = body.lng;
        patch.lat = body.lat;
      }

      if (!Object.keys(patch).length) {
        res.status(400).json({ error: 'Sin campos para actualizar' });
        return;
      }

      const { updated } = await updateEventoReporteById(pool, rRed.red, id, patch);
      if (!updated) {
        res.status(404).json({ error: 'Evento no encontrado' });
        return;
      }
      res.status(200).json({ ok: true, id });
    } catch (e) {
      if (e.code === '23503') {
        res.status(400).json({ error: 'ruta_id no existe en rutas' });
        return;
      }
      next(e);
    }
  });

  /**
   * GET: lista eventos de la red (GeoJSON + filas para el panel) y evita 404 en prefetch.
   */
  r.get('/', async (req, res, next) => {
    const rRed = redTipoDesdePeticionLectura(req);
    if (!rRed.ok) {
      res.status(400).json({ error: rRed.error });
      return;
    }
    try {
      const lim = Number(req.query.limit);
      /** @type {string[] | null} */
      let moleculaCodigoVariants = null;
      const rawCodigo = queryStringParam(req, 'molecula_codigo');
      if (rawCodigo) {
        const parts = String(rawCodigo)
          .split('|')
          .map((s) => s.trim());
        if (parts.length >= 2 && parts[0] && parts[1]) {
          moleculaCodigoVariants = buildMoleculaCodigoVariants(parts[0], parts[1]);
        }
      } else {
        const central = queryStringParam(req, 'central');
        const molecula = queryStringParam(req, 'molecula');
        if (central && molecula) {
          moleculaCodigoVariants = buildMoleculaCodigoVariants(central, molecula);
        }
      }
      if (moleculaCodigoVariants && moleculaCodigoVariants.length === 0) {
        moleculaCodigoVariants = null;
      }

      const { featureCollection, items } = await listEventosReporteForRed(pool, {
        red: rRed.red,
        limit: Number.isFinite(lim) && lim > 0 ? lim : 500,
        moleculaCodigoVariants
      });
      res.status(200).json({
        ok: true,
        red: rRed.red,
        featureCollection,
        items,
        moleculeFilter:
          moleculaCodigoVariants && moleculaCodigoVariants.length
            ? { variants: moleculaCodigoVariants }
            : null
      });
    } catch (e) {
      if (e.code === '42P01') {
        res.status(503).json({
          error: 'Tabla eventos_reporte no existe. Ejecuta sql/06_eventos_reporte.sql en PostgreSQL.'
        });
        return;
      }
      next(e);
    }
  });

  r.post('/', requireBearerAuth, async (req, res, next) => {
    try {
      const rRed = redTipoDesdePeticionLectura(req);
      if (!rRed.ok) {
        res.status(400).json({ error: rRed.error });
        return;
      }

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const tipo_evento = String(body.tipo_evento ?? '')
        .trim()
        .toUpperCase();
      const estado = String(body.estado ?? '')
        .trim()
        .toUpperCase();
      let accion = String(body.accion ?? '').trim();
      if (accion.toUpperCase() === 'INTERVENCION TECNICA') {
        accion = 'INTERVENCIÓN TECNICA';
      }
      const descripcion = String(body.descripcion ?? '').trim().slice(0, MAX_DESC);

      if (!TIPOS.has(tipo_evento)) {
        res.status(400).json({ error: 'tipo_evento no válido' });
        return;
      }
      if (!ESTADOS.has(estado)) {
        res.status(400).json({ error: 'estado no válido' });
        return;
      }
      if (!ACCIONES.has(accion)) {
        res.status(400).json({ error: 'accion no válida' });
        return;
      }
      if (!descripcion) {
        res.status(400).json({ error: 'descripcion requerida' });
        return;
      }

      let dist_odf = null;
      if (body.dist_odf != null && body.dist_odf !== '') {
        const d = Number(body.dist_odf);
        if (Number.isFinite(d) && d >= 0) dist_odf = d;
      }

      let ruta_id = null;
      if (body.ruta_id != null && body.ruta_id !== '') {
        const id = Number(body.ruta_id);
        if (Number.isInteger(id) && id > 0) ruta_id = id;
      }

      const nombre_tendido =
        body.nombre_tendido != null ? String(body.nombre_tendido).trim().slice(0, 500) || null : null;

      let lng = null;
      let lat = null;
      if (body.lng != null && body.lat != null) {
        const lo = Number(body.lng);
        const la = Number(body.lat);
        if (Number.isFinite(lo) && Number.isFinite(la) && lo >= -180 && lo <= 180 && la >= -90 && la <= 90) {
          lng = lo;
          lat = la;
        }
      }

      const row = await insertEventoReporte(pool, {
        red: rRed.red,
        dist_odf,
        tipo_evento,
        estado,
        accion,
        descripcion,
        ruta_id,
        nombre_tendido,
        lng,
        lat
      });
      res.status(201).json({ ok: true, id: row.id });
    } catch (e) {
      if (e.code === '42P01') {
        res.status(503).json({
          error: 'Tabla eventos_reporte no existe. Ejecuta sql/06_eventos_reporte.sql en PostgreSQL.'
        });
        return;
      }
      if (e.code === '23503') {
        res.status(400).json({ error: 'ruta_id no existe en rutas' });
        return;
      }
      if (e.code === '42883' || /st_makepoint|postgis/i.test(String(e.message ?? ''))) {
        res.status(503).json({
          error:
            'PostGIS no disponible o función ST_MakePoint no encontrada. En la base ejecuta: CREATE EXTENSION IF NOT EXISTS postgis;'
        });
        return;
      }
      next(e);
    }
  });

  return r;
}
