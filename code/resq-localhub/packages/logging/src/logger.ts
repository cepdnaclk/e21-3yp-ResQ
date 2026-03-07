type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export class Logger {
  constructor(private module: string, private level: LogLevel = 'info') {}

  log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
    if (this.shouldLog(level)) {
      const time = new Date().toISOString();
      const metaStr = meta ? JSON.stringify(meta) : '';
      console.log(`[${time}] [${level.toUpperCase()}] [${this.module}] ${message}${metaStr ? ' ' + metaStr : ''}`);
    }
  }

  debug(msg: string, meta?: Record<string, unknown>) { this.log('debug', msg, meta); }
  info(msg: string, meta?: Record<string, unknown>) { this.log('info', msg, meta); }
  warn(msg: string, meta?: Record<string, unknown>) { this.log('warn', msg, meta); }
  error(msg: string, meta?: Record<string, unknown>) { this.log('error', msg, meta); }

  private shouldLog(level: LogLevel) {
    const order = ['debug', 'info', 'warn', 'error'];
    return order.indexOf(level) >= order.indexOf(this.level);
  }
}

export function createLogger(module: string, level: LogLevel = 'info') {
  return new Logger(module, level);
}// configure and export winston logger instance
// TODO: set up transports and formats
