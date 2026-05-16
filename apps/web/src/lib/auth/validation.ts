import { z } from "zod";

export const passwordSchema = z
  .string()
  .min(6, "Password must be at least 6 characters")
  .max(128);

export const emailSchema = z.string().email("Enter a valid email");

export const displayNameSchema = z
  .string()
  .trim()
  .min(3, "Name must be at least 3 characters")
  .max(24, "Name must be at most 24 characters")
  .regex(/^[a-zA-Z0-9_-]+$/, "Use letters, numbers, underscores, or hyphens only")
  .refine((n) => !/^u_[a-z0-9]{5}$/i.test(n), "This name format is reserved")
  .refine(
    (n) => !["admin", "system", "flux", "moderator"].includes(n.toLowerCase()),
    "This name is reserved",
  );

export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema.optional(),
});

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});

export const joinCodeSchema = z
  .string()
  .transform((s) => s.replace(/\D/g, "").slice(0, 6))
  .refine((s) => s.length === 6, "Enter a 6-digit room code");
