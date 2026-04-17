export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class Logger {
  constructor(
    private moduleName: string,
    private level: LogLevel = "info"
  ) {}

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[this.level];
  }

  private write(level: LogLevel, message: string, meta?: Record<string, unknown>) {
    if (!this.shouldLog(level)) return;

    const time = new Date().toISOString();
    const payload = {
      time,
      level,
      module: this.moduleName,
      message,
      ...(meta ? { meta } : {}),
    };

    console.log(JSON.stringify(payload));
  }

  debug(message: string, meta?: Record<string, unknown>) {
    this.write("debug", message, meta);
  }

  info(message: string, meta?: Record<string, unknown>) {
    this.write("info", message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>) {
    this.write("warn", message, meta);
  }

  error(message: string, meta?: Record<string, unknown>) {
    this.write("error", message, meta);
  }

  child(childModule: string): Logger {
    return new Logger(`${this.moduleName}:${childModule}`, this.level);
  }
}

export function createLogger(moduleName: string, level: LogLevel = "info"): Logger {
  return new Logger(moduleName, level);
}