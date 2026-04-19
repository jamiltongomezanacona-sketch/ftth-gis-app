import crypto from 'node:crypto';
import express from 'express';
import { verifyPassword } from './authPassword.js';

function validEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s).trim());
}

function isProductionLike() {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
}

/**
 * POST /login { email, password }
 *
 * Orden:
 * 1) Tabla `gis_users`: si existe y el correo está dado de alta → validar hash (varios usuarios).
 * 2) Variables `GIS_AUTH_EMAIL` + `GIS_AUTH_PASS`: un solo usuario administrador (compatibilidad).
 * 3) Modo desarrollo (no producción): correo válido + contraseña ≥ 4 caracteres.
 *
 * @param {import('pg').Pool | null} pool
 */
export function createAuthRouter(pool) {
  const r = express.Router();

  r.post('/login', async (req, res) => {
    const emailRaw = String(req.body?.email ?? '').trim();
    const password = String(req.body?.password ?? '');
    const fixedEmail = process.env.GIS_AUTH_EMAIL?.trim();
    const fixedPass = process.env.GIS_AUTH_PASS;

    if (!validEmail(emailRaw)) {
      res.status(400).json({ error: 'Introduce un correo válido.' });
      return;
    }

    const emailLower = emailRaw.toLowerCase();

    /** @type {string | null} */
    let storedHash = null;

    if (pool) {
      try {
        const { rows } = await pool.query(
          'SELECT password_hash FROM gis_users WHERE email = $1 LIMIT 1',
          [emailLower]
        );
        storedHash = rows[0]?.password_hash ?? null;
      } catch (e) {
        if (e.code === '42P01') {
          /* tabla aún no creada → sigue opciones GIS_AUTH_* o modo dev */
        } else {
          console.error('[auth] gis_users:', e.message);
          res.status(503).json({ error: 'No se pudo comprobar usuarios en base de datos.' });
          return;
        }
      }
    }

    if (storedHash) {
      if (verifyPassword(password, storedHash)) {
        const token = crypto.randomBytes(24).toString('hex');
        res.json({ ok: true, token, email: emailRaw });
        return;
      }
      res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
      return;
    }

    if (fixedEmail && fixedPass != null && String(fixedPass).length > 0) {
      if (emailLower === fixedEmail.toLowerCase() && password === String(fixedPass)) {
        const token = crypto.randomBytes(24).toString('hex');
        res.json({ ok: true, token, email: emailRaw });
        return;
      }
      res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
      return;
    }

    if (!isProductionLike()) {
      if (password.length < 4) {
        res.status(400).json({
          error:
            'La contraseña debe tener al menos 4 caracteres (modo desarrollo sin usuarios en BD ni GIS_AUTH_*).'
        });
        return;
      }
      const token = crypto.randomBytes(24).toString('hex');
      res.json({ ok: true, token, email: emailRaw });
      return;
    }

    res.status(401).json({
      error:
        'Acceso no configurado: crea usuarios con npm run user:add (tabla gis_users) o define GIS_AUTH_EMAIL y GIS_AUTH_PASS.'
    });
  });

  return r;
}
