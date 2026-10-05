import compression from 'compression';
import express from 'express';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { env } from './env';
import { errorHandler, notFoundHandler } from './middleware/error';
import { roleMiddleware } from './middleware/role';
import { buttaPartiesRouter } from './routes/butta-parties';
import { buttaQcRouter } from './routes/butta-qc';
import { buttaRouter } from './routes/butta';
import { customersRouter } from './routes/customers';
import { damagesRouter } from './routes/damages';
import { designsRouter } from './routes/designs';
import { jobsheetsRouter } from './routes/jobsheets';
import { lookupRouter } from './routes/lookup';
import { machineViewRouter } from './routes/machine-view';
import { machinesRouter } from './routes/machines';
import { materialsRouter } from './routes/materials';
import { ordersRouter } from './routes/orders';
import { takaRouter } from './routes/taka';
import { takasRouter } from './routes/takas';
import { uploadsRouter } from './routes/uploads';

const app = express();
app.disable('x-powered-by');
app.set('etag', 'strong');
app.use(compression());
app.use(express.json({ limit: '1mb' }));

// On Vercel (serverless, read-only disk) there is no listen() and images live on Cloudinary.
const onVercel = Boolean(process.env.VERCEL);

// Uploaded images: file names are unique, so they can be cached forever.
if (!onVercel) {
  mkdirSync(env.uploadsDir, { recursive: true });
  app.use(
    '/uploads',
    express.static(env.uploadsDir, { immutable: true, maxAge: '365d', index: false, fallthrough: false }),
  );
}

const api = express.Router();
api.get('/health', (_req, res) => {
  res.json({ ok: true });
});
api.use(roleMiddleware);
api.use('/orders', ordersRouter);
api.use('/customers', customersRouter);
api.use('/materials', materialsRouter);
api.use('/damages', damagesRouter);
api.use('/designs', designsRouter);
api.use('/machines', machinesRouter);
api.use('/jobsheets', jobsheetsRouter);
api.use('/machine-view', machineViewRouter);
api.use('/taka', takaRouter);
api.use('/takas', takasRouter);
api.use('/butta-parties', buttaPartiesRouter);
api.use('/butta', buttaRouter);
api.use('/butta-qc', buttaQcRouter);
api.use('/lookup', lookupRouter);
api.use('/uploads', uploadsRouter);
api.use(notFoundHandler);
app.use('/api', api);

// In production the server also serves the built React app.
if (env.clientDist && !onVercel) {
  const dist = env.clientDist;
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('*', (_req, res) => {
    res.sendFile(join(dist, 'index.html'));
  });
}

app.use(errorHandler);

if (!onVercel) {
  app.listen(env.port, () => {
    console.log(`Rivoora API listening on http://localhost:${env.port}`);
  });
}

/** Used by the Vercel function (scripts/vercel-build.mjs bundles this file). */
export default app;
