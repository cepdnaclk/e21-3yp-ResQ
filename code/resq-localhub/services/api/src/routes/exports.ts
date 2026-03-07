import { FastifyPluginAsync } from 'fastify';
const exportsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/exports/:sessionId/csv', async (req, reply) => {
    // TODO: Export CSV
    return { exported: true, format: 'csv' };
  });
  app.get('/exports/:sessionId/json', async (req, reply) => {
    // TODO: Export JSON
    return { exported: true, format: 'json' };
  });
};
export default exportsRoutes;