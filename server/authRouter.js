import crypto from 'node:crypto';
import express from 'express';

function validEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s).trim());
}

/**
 * POST /login { email, password }
 * Si GIS_AUTH_EMAIL y GIS_AUTH_PASS están definidos (no vacíos), solo acepta ese par.
 * Si no, modo desarrollo: correo con formato válido y contraseña ≥ 4 caracteres.
 */
export function createAuthRouter() {
  const r = express.Router();

  r.post('/login', (req, res) => {
    const email = String(req.body?.email ?? '').trim();
    const password = String(req.body?.password ?? '');
    const fixedEmail = process.env.GIS_AUTH_EMAIL?.trim();
    const fixedPass = process.env.GIS_AUTH_PASS;

    if (fixedEmail && fixedPass != null && String(fixedPass).length > 0) {
      if (email !== fixedEmail || password !== String(fixedPass)) {
        res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
        return;
      }
    } else {
      if (!validEmail(email)) {
        res.status(400).json({ error: 'Introduce un correo válido.' });
        return;
      }
      if (password.length < 4) {
        res
          .status(400)
          .json({
            error:
              'La contraseña debe tener al menos 4 caracteres (modo desarrollo sin GIS_AUTH_* en .env).'
          });
        return;
      }
    }

    const token = crypto.randomBytes(24).toString('hex');
    res.json({ ok: true, token, email });
  });

  return r;
}
