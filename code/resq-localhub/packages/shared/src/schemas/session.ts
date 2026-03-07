import { z } from 'zod';
export const SessionStartSchema = z.object({
  manikinIds: z.array(z.string()),
  instructorId: z.string(),
});
export const SessionEndSchema = z.object({
  sessionId: z.string(),
});// validation schema for session objects
// TODO: implement fields and constraints
