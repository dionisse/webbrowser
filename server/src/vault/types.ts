import { z } from 'zod';

/** KDF parameters for the browser-side master key derivation. */
export const KdfSchema = z.object({
  alg: z.literal('PBKDF2-SHA256'),
  iterations: z.number().int().min(100_000).max(5_000_000),
  salt: z.string().min(8), // base64
});
export type Kdf = z.infer<typeof KdfSchema>;

/**
 * The public account record. Safe to store in clear text: it contains no
 * secret material, only the parameters needed to re-derive a key and an
 * irreversible verifier used to check an unlock attempt.
 */
export const AccountRecordSchema = z.object({
  v: z.literal(1),
  profileId: z.string().min(1),
  label: z.string().min(1).max(80),
  hue: z.number().min(0).max(360).optional(),
  kdf: KdfSchema,
  cipher: z.literal('AES-GCM-256'),
  /** SHA-256(authHash + serverPepper). authHash itself is never stored. */
  authVerifier: z.string().min(32),
  /** Reference into the connection registry (`local` by default). */
  connectionId: z.string().min(1),
  /** Convenience copy of the provider behind `connectionId`. */
  providerId: z.string().min(1),
  drivePath: z.string().min(1),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastSeenAt: z.number().optional(),
  revision: z.number().int().nonnegative(),
});
export type AccountRecord = z.infer<typeof AccountRecordSchema>;

export const CreateProfileSchema = z.object({
  label: z.string().min(1).max(80),
  hue: z.number().min(0).max(360).optional(),
  kdf: KdfSchema,
  authHash: z.string().min(32),
  /** Connection registry id. Defaults to `local`. */
  connectionId: z.string().optional(),
  /** Encrypted vault payload produced in the browser. Opaque to the server. */
  vault: z.string().min(1),
});
export type CreateProfileInput = z.infer<typeof CreateProfileSchema>;

export const UnlockSchema = z.object({
  profileId: z.string().min(1),
  authHash: z.string().min(32),
});
export type UnlockInput = z.infer<typeof UnlockSchema>;

export const SaveVaultSchema = z.object({
  vault: z.string().min(1),
  baseRevision: z.number().int().nonnegative().optional(),
  snapshot: z.boolean().optional(),
});
export type SaveVaultInput = z.infer<typeof SaveVaultSchema>;

export const ConnectProviderSchema = z.object({
  providerId: z.string().min(1),
  credentials: z.record(z.string()).optional(),
});
export type ConnectProviderInput = z.infer<typeof ConnectProviderSchema>;
