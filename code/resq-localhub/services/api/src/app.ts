import { FastifyInstance } from 'fastify';
import envPlugin from './plugins/env';
import dbPlugin from './plugins/db';
import authPlugin from './plugins/auth';
import websocketPlugin from './plugins/websocket';
import hubRoutes from './routes/hub';
import manikinsRoutes from './routes/manikins';
import sessionsRoutes from './routes/sessions';
import exportsRoutes from './routes/exports';
import localAuthRoutes from './routes/localAuth';

export function registerPlugins(app: FastifyInstance) {
  app.register(envPlugin);
  app.register(dbPlugin);
  app.register(authPlugin);
  app.register(websocketPlugin);

  app.register(hubRoutes, { prefix: '/api' });
  app.register(manikinsRoutes, { prefix: '/api' });
  app.register(sessionsRoutes, { prefix: '/api' });
  app.register(exportsRoutes, { prefix: '/api' });
  app.register(localAuthRoutes, { prefix: '/api' });
}