import { FastifyPluginAsync } from 'fastify';

const dbPlugin: FastifyPluginAsync = async (app) => {
  app.decorate('db', {});
};

export default dbPlugin;