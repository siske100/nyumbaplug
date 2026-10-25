import { z } from "zod";
import { COUNTIES, HOUSE_TYPES } from "./counties.ts";

/** Every form validates with these. The server repeats the same checks: the browser is never trusted. */

export const normalizePhone = (raw: string) =>
  raw.replace(/[\s-]/g, "").replace(/^\+254/, "0").replace(/^254/, "0");

export const kenyanPhone = z
  .string()
  .pipe(z.string().transform(normalizePhone))
  .pipe(z.string().regex(/^(07|01)\d{8}$/, "Enter a valid Kenyan phone number, like 0712 345 678"));

const COMMON_PASSWORDS = new Set(["password123", "1234567890", "qwertyuiop", "iloveyou123", "welcome123"]);

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(128, "Use 128 characters or fewer")
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), "Use both letters and numbers")
  .refine((v) => !COMMON_PASSWORDS.has(v.toLowerCase()), "That password is too common. Choose another");

export const emailSchema = z.email("Enter a valid email address").max(254);

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password"),
});

export const landlordSignUpSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name").max(120),
  email: emailSchema,
  phone: kenyanPhone,
  password: passwordSchema,
});

export const nationalIdSchema = z.string().regex(/^\d{7,8}$/, "National ID is 7 or 8 digits");
export const kraPinSchema = z
  .string()
  .transform((v) => v.trim().toUpperCase())
  .pipe(z.string().regex(/^[AP]\d{9}[A-Z]$/, "KRA PIN looks like A012345678Z"));

export const vacantUnitsSchema = z
  .object({ vacant: z.number().int().min(0, "Vacant units cannot be negative"), total: z.number().int().min(1) })
  .refine((v) => v.vacant <= v.total, { path: ["vacant"], message: "Vacant units cannot exceed total units" });

export const MAX_PHOTOS = 7;
export const MIN_PHOTOS = 3;
export const houseSchema = z
  .object({
    title: z.string().trim().min(3).max(80),
    county: z.enum(COUNTIES),
    town: z.string().trim().min(2).max(60),
    type: z.enum(HOUSE_TYPES),
    rent: z.number().int().positive().max(1_000_000),
    total: z.number().int().min(1).max(500),
    vacant: z.number().int().min(0),
    photos: z.number().int().min(MIN_PHOTOS, `Add at least ${MIN_PHOTOS} photos`).max(MAX_PHOTOS, `Maximum ${MAX_PHOTOS} photos`),
  })
  .refine((v) => v.vacant <= v.total, { path: ["vacant"], message: "Vacant units cannot exceed total units" });

/** Tenant record: tenant phone and an emergency contact are required, and must be different people. */
export const tenantSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    phone: kenyanPhone,
    emergencyName: z.string().trim().min(2, "Enter the emergency contact's name").max(120),
    emergencyPhone: kenyanPhone,
    emergencyRelationship: z.string().trim().min(2, "Enter how they are related").max(40),
    unitLabel: z.string().trim().min(1).max(20),
  })
  .refine((v) => v.phone !== v.emergencyPhone, {
    path: ["emergencyPhone"],
    message: "The emergency contact must be a different number from the tenant",
  });

const DAY = 86_400_000;
export const isWithinNextDays = (iso: string, days: number, now = new Date()) => {
  const d = new Date(`${iso}T00:00:00`);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return !Number.isNaN(d.getTime()) && d.getTime() >= start && d.getTime() <= start + days * DAY;
};

export const viewingRequestSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(120),
  phone: kenyanPhone,
  date: z.string().refine((v) => isWithinNextDays(v, 7), "Pick a date within the next 7 days"),
  window: z.enum(["Morning", "Afternoon", "Evening"]),
});
