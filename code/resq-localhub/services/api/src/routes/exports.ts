import { FastifyPluginAsync } from 'fastify';

const exportsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/export/sessions/:sessionId.csv', async () => {
    return { exported: true, format: 'csv' };
  });

  app.get('/export/sessions/:sessionId.json', async () => {
    return { exported: true, format: 'json' };
  });
};

export default exportsRoutes;