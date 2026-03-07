import fastify from 'fastify';
import { registerPlugins } from './app';

const app = fastify({ logger: true });
registerPlugins(app);

app.listen({ port: 8080 }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`ResQ Local Hub API listening at ${address}`);
});import fastify from 'fastify';
import { registerPlugins } from './app';

const app = fastify({ logger: true });
registerPlugins(app);

app.listen({ port: 8080 }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`ResQ Local Hub API listening at ${address}`);
});import fastify from 'fastify';
import { registerPlugins } from './app';

const app = fastify({ logger: true });
registerPlugins(app);

app.listen({ port: 8080 }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`ResQ Local Hub API listening at ${address}`);
});import Fastify from 'fastify';

const app = Fastify();

app.get('/', async (request, reply) => {
  reply.send({ status: 'ok' });
});

// TODO: add REST endpoints and websocket/live updates

app.listen({ port: Number(process.env.PORT) || 3000 }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`API listening at ${address}`);
});
