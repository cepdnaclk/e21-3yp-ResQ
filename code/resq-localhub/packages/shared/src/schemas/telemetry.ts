import { z } from 'zod';
export const TelemetryPayloadSchema = z.object({
  manikinId: z.string(),
  timestamp: z.string(),
  values: z.record(z.number()),
});// validation schema for telemetry data
// TODO: enforce types and ranges
