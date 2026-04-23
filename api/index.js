/**
 * Entrada serverless para Vercel: misma app Express que en local (`npm start`).
 * Cargar dotenv antes de importar la app (pool y rutas leen process.env).
 */
import 'dotenv/config';
import app from '../server/app.js';

export default app;
