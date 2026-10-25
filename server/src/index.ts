import compression from 'compression';
import express from 'express';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { env } from './env';
import { errorHandler, notFoundHandler } from './middleware/error';
import { authMiddleware } from './middleware/role';
import { holdGuard } from './middleware/hold-guard';
import { authRouter } from './routes/auth';
import { usersRouter } from './routes/users';
import { buttaQcRouter } from './routes/butta-qc';
import { millQcRouter } from './routes/mill-qc';
import { challansRouter } from './routes/challans';
import { customersRouter } from './routes/customers';
import { damagesRouter } from './routes/damages';
import { designsRouter } from './routes/designs';
import { godownRouter } from './routes/godown';
import { inventoryRouter } from './routes/inventory';
import { jobsheetsRouter } from './routes/jobsheets';
import { lookupRouter } from './routes/lookup';
import { machineViewRouter } from './routes/machine-view';
import { machinesRouter } from './routes/machines';
import { materialsRouter } from './routes/materials';
import { ordersRouter } from './routes/orders';
import { partiesRouter } from './routes/parties';
import { takaRouter } from './routes/taka';
import { takasRouter } from './routes/takas';
import { uploadsRouter } from './routes/uploads';
import { dispatchRouter, dispatchedRouter } from './routes/dispatch';
import { weaversRouter } from './routes/weavers';
import { outsidePosRouter, receiveGoodsRouter } from './routes/outside';
import { tfoMachinesRouter, yarnPartiesRouter, yarnQualitiesRouter } from './routes/yarn-masters';
import { yarnPosRouter } from './routes/yarn-po';
import { yarnRouter } from './routes/yarn';

const app = express();
app.disable('x-powered-by');
// Behind Vercel / a proxy: req.ip (login rate limiting) comes from X-Forwarded-For.
app.set('trust proxy', 1);
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
// Public: /health and /auth/login. Everything below needs a valid session (cookie).
api.use('/auth', authRouter);
api.use(authMiddleware);
// Sprint 15: a held order blocks every write (except receiving) and is hidden from all roles but Jenish / Gaurang.
api.use(holdGuard);
api.use('/users', usersRouter);
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
api.use('/butta-parties', partiesRouter('butta'));
api.use('/mill-parties', partiesRouter('mill'));
api.use('/butta', challansRouter('butta'));
api.use('/mill', challansRouter('mill'));
api.use('/butta-qc', buttaQcRouter);
api.use('/mill-qc', millQcRouter);
api.use('/godown', godownRouter);
api.use('/inventory', inventoryRouter);
api.use('/dispatch', dispatchRouter);
api.use('/dispatched', dispatchedRouter);
// Sprint 16: weavers, outside POs, Receive goods.
api.use('/weavers', weaversRouter);
api.use('/outside-pos', outsidePosRouter);
api.use('/receive-goods', receiveGoodsRouter);
// Sprint 17: yarn (not linked to orders, so the hold guard never touches these).
api.use('/yarn-parties', yarnPartiesRouter);
api.use('/yarn-qualities', yarnQualitiesRouter);
api.use('/tfo-machines', tfoMachinesRouter);
api.use('/yarn-pos', yarnPosRouter);
api.use('/yarn', yarnRouter);
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
