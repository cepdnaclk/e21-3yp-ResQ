import { FastifyPluginAsync } from 'fastify';
const hubRoutes: FastifyPluginAsync = async (app) => {
  app.get('/hub/health', async () => {
    return { status: 'ok', hubName: 'resq-hub', version: '0.1.0' };
  });
};
export default hubRoutes;import { FastifyPluginAsync } from 'fastify';
const hubRoutes: FastifyPluginAsync = async (app) => {
  app.get('/hub/health', async () => {
    return { status: 'ok', hubName: 'resq-hub', version: '0.1.0' };
  });
};
export default hubRoutes;import { FastifyPluginAsync } from 'fastify';
const hubRoutes: FastifyPluginAsync = async (app) => {
  app.get('/hub/health', async () => {
    return { status: 'ok', hubName: 'resq-hub', version: '0.1.0' };
  });
};
export default hubRoutes;// hub related routes
// TODO: define endpoints for overall hub info
