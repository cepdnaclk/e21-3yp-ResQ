import { FastifyPluginAsync } from 'fastify';
const dbPlugin: FastifyPluginAsync = async (app) => {
  // TODO: Connect to SQLite and expose DB client
  app.decorate('db', {});
};
export default dbPlugin;import { FastifyPluginAsync } from 'fastify';
const dbPlugin: FastifyPluginAsync = async (app) => {
  // TODO: Connect to SQLite and expose DB client
  app.decorate('db', {});
};
export default dbPlugin;import { FastifyPluginAsync } from 'fastify';
const dbPlugin: FastifyPluginAsync = async (app) => {
  // TODO: Connect to SQLite and expose DB client
  app.decorate('db', {});
};
export default dbPlugin;// plugin to register database client (SQLite) with Fastify
// TODO: initialize connection and migrations
