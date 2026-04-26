import { Router } from 'express';
import {
  deleteCierreById,
  fetchCierresAsFeatureCollection,
  fetchCierresSearch,
  insertCierre,
  isUuidString,
  updateCierreById
} from './cierresRepo.js';
import { queryStringParam, redTipoDesdePeticionLectura } from './rutasShared.js';

/**
 * Variantes de `CENTRAL|MOL` para coincidir con la BD (espacios vs guiones bajos).
 * @param {string} central
 * @param {string} molecula
 * @returns {string[]}
 */
export function buildMoleculaCodigoVariants(central, molecula) {
  const m = String(molecula ?? '').trim();
  const raw = String(central ?? '').trim();
  if (!m || !raw) return [];
  const under = raw.replace(/\s+/g, '_');
  /** @type {Set<string>} */
  const out = new Set();
  out.add(`${raw}|${m}`);
  out.add(`${under}|${m}`);
  return [...out];
}

/**
 * @param {import('pg').Pool} pool
 * @param {{ requireBearerAuth: import('express').RequestHandler }} opts
 */
export function createCierresRouter(pool, opts) {
  const { requireBearerAuth } = opts;
  const r = Router();

  r.post('/', requireBearerAuth, async (req, res, next) => {
    try {
      const rRed = redTipoDesdePeticionLectura(req);
      if (!rRed.ok) {
        res.status(400).json({ error: rRed.error });
        return;
      }
      if (rRed.red !== 'ftth') {
        res.status(400).json({ error: 'Solo red FTTH' });
        return;
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const { id } = await insertCierre(pool, body);
      res.status(201).json({ ok: true, id });
    } catch (e) {
      if (e?.code === 'VALIDATION') {
        res.status(400).json({ error: e.message || 'Datos inválidos' });
        return;
      }
      next(e);
    }
  });

  r.delete('/:id', requireBearerAuth, async (req, res, next) => {
    try {
      const rRed = redTipoDesdePeticionLectura(req);
      if (!rRed.ok) {
        res.status(400).json({ error: rRed.error });
        return;
      }
      if (rRed.red !== 'ftth') {
        res.status(400).json({ error: 'Solo red FTTH' });
        return;
      }
      const id = String(req.params.id ?? '').trim();
      if (!isUuidString(id)) {
        res.status(400).json({ error: 'id debe ser UUID' });
        return;
      }
      const { deleted } = await deleteCierreById(pool, id);
      if (!deleted) {
        res.status(404).json({ error: 'Cierre no encontrado' });
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
      if (rRed.red !== 'ftth') {
        res.status(400).json({ error: 'Solo red FTTH' });
        return;
      }
      const id = String(req.params.id ?? '').trim();
      if (!isUuidString(id)) {
        res.status(400).json({ error: 'id debe ser UUID' });
        return;
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      /** @type {Record<string, unknown>} */
      const patch = {};
      for (const k of [
        'nombre',
        'tipo',
        'estado',
        'descripcion',
        'molecula_codigo',
        'dist_odf',
        'lat',
        'lng'
      ]) {
        if (Object.prototype.hasOwnProperty.call(body, k)) {
          patch[k] = body[k];
        }
      }
      if (Object.keys(patch).length === 0) {
        res.status(400).json({ error: 'Sin campos para actualizar' });
        return;
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'lat') !== Object.prototype.hasOwnProperty.call(patch, 'lng')) {
        res.status(400).json({ error: 'lat y lng deben enviarse juntos' });
        return;
      }
      const { updated } = await updateCierreById(pool, id, patch);
      if (!updated) {
        res.status(404).json({ error: 'Cierre no encontrado' });
        return;
      }
      res.status(200).json({ ok: true, id });
    } catch (e) {
      next(e);
    }
  });

  /**
   * Búsqueda global: ?buscar=E2 (recomendado), ?search= o ?q= (alias).
   * No usar solo `!== undefined` sobre `search`: en algunos entornos el parámetro no llega y cae 400.
   * Molécula: ?central=&molecula= o ?molecula_codigo=
   */
  r.get('/', async (req, res, next) => {
    try {
      const rRed = redTipoDesdePeticionLectura(req);
      if (!rRed.ok) {
        res.status(400).json({ error: rRed.error });
        return;
      }
      if (rRed.red !== 'ftth') {
        res.json({ type: 'FeatureCollection', features: [] });
        return;
      }

      const searchText = String(
        queryStringParam(req, 'buscar') ||
          queryStringParam(req, 'search') ||
          queryStringParam(req, 'q')
      ).trim();
      // 1 carácter: vacío (antes caía en 400 por falta de molecula_codigo/central+molecula).
      if (searchText.length === 1) {
        res.json({ type: 'FeatureCollection', features: [] });
        return;
      }
      if (searchText.length >= 2) {
        const lim = Number(queryStringParam(req, 'limit'));
        const fc = await fetchCierresSearch(
          pool,
          searchText,
          Number.isFinite(lim) ? lim : 40
        );
        res.json(fc);
        return;
      }

      let codigos = /** @type {string[]} */ ([]);
      const rawCodigo = queryStringParam(req, 'molecula_codigo');
      if (rawCodigo) {
        codigos = [rawCodigo];
      } else {
        const central = queryStringParam(req, 'central');
        const molecula = queryStringParam(req, 'molecula');
        if (central && molecula) {
          codigos = buildMoleculaCodigoVariants(central, molecula);
        }
      }

      if (!codigos.length) {
        res.json({ type: 'FeatureCollection', features: [] });
        return;
      }

      const fc = await fetchCierresAsFeatureCollection(pool, codigos);
      res.json(fc);
    } catch (e) {
      if (e.code === '42P01') {
        res.status(503).json({
          error:
            'Tabla cierres no instalada. Ejecuta sql/04_cierres.sql y carga cierres_datos.sql.'
        });
        return;
      }
      next(e);
    }
  });

  return r;
}
