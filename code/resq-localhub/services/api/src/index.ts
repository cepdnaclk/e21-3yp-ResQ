import fastify from 'fastify';
import { registerPlugins } from './app';

const app = fastify({ logger: true });

registerPlugins(app);

app.listen({ port: 8080, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }

  app.log.info(`ResQ Local Hub API listening at ${address}`);
});