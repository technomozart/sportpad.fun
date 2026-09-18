import { z } from "zod";

const optionalHttpsUrl = z
  .string()
  .trim()
  .max(2_048, "URLs must be 2,048 characters or fewer.")
  .refine((value) => {
    if (!value) return true;
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "URLs must use a valid HTTPS address.")
  .optional()
  .default("");

const attestationsSchema = z
  .object({
    rights: z.boolean(),
    unofficial: z.boolean(),
    economics: z.boolean(),
  })
  .strict()
  .refine((value) => value.rights && value.unofficial && value.economics, {
    message: "All creator attestations are required.",
  });

export const launchDraftPayloadSchema = z
  .object({
    name: z.string().trim().min(2, "Coin name must be 2-32 characters.").max(32, "Coin name must be 2-32 characters."),
    symbol: z
      .string()
      .trim()
      .transform((value) => value.toUpperCase())
      .pipe(z.string().regex(/^[A-Z0-9]{2,10}$/, "Ticker must be 2-10 letters or numbers.")),
    description: z.string().trim().max(280, "Description must be 280 characters or fewer.").optional().default(""),
    sport: z.enum(["Football", "Combat", "Motorsport", "Basketball"], {
      message: "Choose a supported sport.",
    }),
    website: optionalHttpsUrl,
    social: optionalHttpsUrl,
    rewardSymbol: z.string().trim().min(1, "Choose a verified reward asset.").max(32),
    attestations: attestationsSchema,
  })
  .strict();

export type LaunchDraftPayload = z.infer<typeof launchDraftPayloadSchema>;
