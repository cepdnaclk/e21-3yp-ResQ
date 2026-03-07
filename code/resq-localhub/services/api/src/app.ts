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
  app.register(authPlugin); // TODO: Implement JWT verification
  app.register(websocketPlugin); // TODO: Implement websocket live updates
  app.register(hubRoutes);
  app.register(manikinsRoutes);
  app.register(sessionsRoutes);
  app.register(exportsRoutes);
  app.register(localAuthRoutes);
}import { FastifyInstance } from 'fastify';
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
  app.register(authPlugin); // TODO: Implement JWT verification
  app.register(websocketPlugin); // TODO: Implement websocket live updates
  app.register(hubRoutes);
  app.register(manikinsRoutes);
  app.register(sessionsRoutes);
  app.register(exportsRoutes);
  app.register(localAuthRoutes);
}import { FastifyInstance } from 'fastify';
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
  app.register(authPlugin); // TODO: Implement JWT verification
  app.register(websocketPlugin); // TODO: Implement websocket live updates
  app.register(hubRoutes);
  app.register(manikinsRoutes);
  app.register(sessionsRoutes);
  app.register(exportsRoutes);
  app.register(localAuthRoutes);
}