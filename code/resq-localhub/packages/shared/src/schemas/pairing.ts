import { z } from 'zod';
export const PairingRequestSchema = z.object({
  manikinId: z.string(),
  token: z.string(),
});// validation schema for pairing requests
// TODO: use zod or similar to define schema
