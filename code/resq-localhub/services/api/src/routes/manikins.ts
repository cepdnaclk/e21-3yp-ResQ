import { FastifyPluginAsync } from 'fastify';

const manikinsRoutes: FastifyPluginAsync = async (app) => {
  app.post('/manikins/pair-request', async () => {
    return { pending: true, mac: 'mock-mac' };
  });

  app.post('/manikins/unpair', async () => {
    return { unpaired: true, mac: 'mock-mac' };
  });

  app.get('/manikins', async () => {
    return [{ id: 'mock-id', name: 'Manikin 1', status: 'online' }];
  });
};

export default manikinsRoutes;