import { FastifyPluginAsync } from 'fastify';

const localAuthRoutes: FastifyPluginAsync = async (app) => {
  app.post('/local-auth', async () => {
    return { authenticated: true, traineeId: 'mock-trainee' };
  });
};

export default localAuthRoutes;