import { FastifyPluginAsync } from 'fastify';
const localAuthRoutes: FastifyPluginAsync = async (app) => {
  app.post('/local-auth', async (req, reply) => {
    // TODO: Implement local trainee authentication
    return { authenticated: true, traineeId: 'mock-trainee' };
  });
};
export default localAuthRoutes;import { FastifyPluginAsync } from 'fastify';
const localAuthRoutes: FastifyPluginAsync = async (app) => {
  app.post('/local-auth', async (req, reply) => {
    // TODO: Implement local trainee authentication
    return { authenticated: true, traineeId: 'mock-trainee' };
  });
};
export default localAuthRoutes;import { FastifyPluginAsync } from 'fastify';
const localAuthRoutes: FastifyPluginAsync = async (app) => {
  app.post('/local-auth', async (req, reply) => {
    // TODO: Implement local trainee authentication
    return { authenticated: true, traineeId: 'mock-trainee' };
  });
};
export default localAuthRoutes;// local authentication routes (login, logout)
// TODO: add credentials check
