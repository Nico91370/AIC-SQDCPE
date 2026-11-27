import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { authenticate, authMode, publicAuthConfig } from './auth.ts';
import { migrate } from './migrate.ts';
import coreRoutes from './routes/core.ts';
import aicRoutes from './routes/aic.ts';
import actionRoutes from './routes/actions.ts';
import pilotageRoutes from './routes/pilotage.ts';
import adminRoutes from './routes/admin.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

app.get('/api/health', async () => ({ ok: true }));
app.get('/api/auth-config', async () => publicAuthConfig());

await app.register(async (api) => {
  api.addHook('preHandler', authenticate);
  await api.register(coreRoutes);
  await api.register(aicRoutes);
  await api.register(actionRoutes);
  await api.register(pilotageRoutes);
  await api.register(adminRoutes);
});

// En production, le serveur distribue aussi l'interface compilée (dossier dist/).
const dist = path.join(root, 'dist');
if (existsSync(dist)) {
  await app.register(fastifyStatic, { root: dist });
  app.setNotFoundHandler((req, reply) =>
    req.url.startsWith('/api/') ? reply.code(404).send({ error: 'Introuvable' }) : reply.sendFile('index.html'));
}

await migrate();
const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: '0.0.0.0' });
app.log.info(`AIC SQDCPE prête sur le port ${port} (authentification : ${authMode})`);
