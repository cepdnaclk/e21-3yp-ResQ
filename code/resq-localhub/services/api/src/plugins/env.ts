import { FastifyPluginAsync } from 'fastify';

const envPlugin: FastifyPluginAsync = async (app) => {
  app.decorate('env', {
    MQTT_PORT: 1883,
    MQTT_WS_PORT: 9001,
    API_PORT: 8080,
    HUB_NAME: 'resq-hub',
    DB_PATH: './data/resq.db',
    LOG_LEVEL: 'info'
  });
};

export default envPlugin;