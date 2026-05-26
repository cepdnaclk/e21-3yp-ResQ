export type LocalUrlOptions = {
  instructorPort: number;
  traineePort: number;
  instructorPath?: string;
  traineePath?: string;
};

export type AccessUrls = {
  instructorUrl: string;
  traineeUrl: string;
};

export const DEFAULT_LOCAL_URL_OPTIONS: LocalUrlOptions = {
  instructorPort: 1430,
  traineePort: 1430,
  instructorPath: "/",
  traineePath: "/",
};

function normalizePath(path: string): string {
  if (path.startsWith("/")) {
    return path;
  }

  return `/${path}`;
}

export function buildInstructorUrl(host: string, options: Partial<LocalUrlOptions> = {}): string {
  const merged = { ...DEFAULT_LOCAL_URL_OPTIONS, ...options };
  return `http://${host}:${merged.instructorPort}${normalizePath(merged.instructorPath ?? "/")}`;
}

export function buildTraineeUrl(host: string, options: Partial<LocalUrlOptions> = {}): string {
  const merged = { ...DEFAULT_LOCAL_URL_OPTIONS, ...options };
  return `http://${host}:${merged.traineePort}${normalizePath(merged.traineePath ?? "/")}`;
}

export function buildAccessUrls(host: string, options: Partial<LocalUrlOptions> = {}): AccessUrls {
  return {
    instructorUrl: buildInstructorUrl(host, options),
    traineeUrl: buildTraineeUrl(host, options),
  };
}