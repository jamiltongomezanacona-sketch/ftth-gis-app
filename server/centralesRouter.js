import { Router } from 'express';
import { fetchCentralesEtBAsFeatureCollection } from './centralesRepo.js';
import { redTipoDesdePeticionLectura } from './rutasShared.js';

/**
 * @param {import('pg').Pool} pool
 */
export function createCentralesRouter(pool) {
  const r = Router();

  /** GET /api/centrales-etb?red=ftth|corporativa — FeatureCollection (Point) */
  r.get('/', async (req, res, next) => {
    try {
      const rRed = redTipoDesdePeticionLectura(req);
      if (!rRed.ok) {
        res.status(400).json({ error: rRed.error });
        return;
      }
      const fc = await fetchCentralesEtBAsFeatureCollection(pool, rRed.red);
      res.json(fc);
    } catch (e) {
      next(e);
    }
  });

  return r;
}
