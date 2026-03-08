import { FastifyPluginAsync } from 'fastify';

const sessionsRoutes: FastifyPluginAsync = async (app) => {
  app.post('/sessions/start', async () => {
    return { started: true, sessionId: 'mock-session' };
  });

  app.post('/sessions/end', async () => {
    return { ended: true, sessionId: 'mock-session' };
  });

  app.get('/sessions/:sessionId', async () => {
    return { sessionId: 'mock-session', summary: {} };
  });
};

export default sessionsRoutes;