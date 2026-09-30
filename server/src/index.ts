import compression from 'compression';
import express from 'express';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { env } from './env';
import { errorHandler, notFoundHandler } from './middleware/error';
import { roleMiddleware } from './middleware/role';
import { customersRouter } from './routes/customers';
import { designsRouter } from './routes/designs';
import { jobsheetsRouter } from './routes/jobsheets';
import { lookupRouter } from './routes/lookup';
import { machineViewRouter } from './routes/machine-view';
import { machinesRouter } from './routes/machines';
import { materialsRouter } from './routes/materials';
import { ordersRouter } from './routes/orders';
import { uploadsRouter } from './routes/uploads';

const app = express();
app.disable('x-powered-by');
app.set('etag', 'strong');
app.use(compression());
app.use(express.json({ limit: '1mb' }));

// Uploaded images: file names are unique, so they can be cached forever.
mkdirSync(env.uploadsDir, { recursive: true });
app.use(
  '/uploads',
  express.static(env.uploadsDir, { immutable: true, maxAge: '365d', index: false, fallthrough: false }),
);

const api = express.Router();
api.get('/health', (_req, res) => {
  res.json({ ok: true });
});
api.use(roleMiddleware);
api.use('/orders', ordersRouter);
api.use('/customers', customersRouter);
api.use('/materials', materialsRouter);
api.use('/designs', designsRouter);
api.use('/machines', machinesRouter);
api.use('/jobsheets', jobsheetsRouter);
api.use('/machine-view', machineViewRouter);
api.use('/lookup', lookupRouter);
api.use('/uploads', uploadsRouter);
api.use(notFoundHandler);
app.use('/api', api);

// In production the server also serves the built React app.
if (env.clientDist) {
  const dist = env.clientDist;
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('*', (_req, res) => {
    res.sendFile(join(dist, 'index.html'));
  });
}

app.use(errorHandler);

app.listen(env.port, () => {
  console.log(`Rivoora API listening on http://localhost:${env.port}`);
});
