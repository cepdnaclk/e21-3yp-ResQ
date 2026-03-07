export * from './env';
export * from './defaults';// configuration loader
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const Config = {
  port: process.env.PORT || '3000',
  sqliteFile: process.env.SQLITE_FILE || './data/database.sqlite',
};

// TODO: enhance with validation and environment profiles
