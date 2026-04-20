export * from './logger';import winston from 'winston';

export const logger = winston.createLogger({
  level: 'info',
  transports: [new winston.transports.Console()],
});

// TODO: configure file transports, formatting, and integration with other packages
