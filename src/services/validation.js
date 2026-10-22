import { z } from 'zod';

const FIELD_TYPES = ['text', 'email', 'textarea'];

const fieldSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]{0,29}$/, 'must be lowercase letters/digits/underscore, start with a letter, max 30 chars'),
    label: z.string().trim().min(1).max(60),
    type: z.enum(FIELD_TYPES),
    required: z.boolean().default(false),
  })
  .strict();

const widgetBase = z
  .object({
    type: z.enum(['signup', 'contact', 'cta', 'popover']),
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).default(''),
    buttonText: z.string().trim().min(1).max(40).default('Submit'),
    fields: z
      .array(fieldSchema)
      .min(1)
      .max(10)
      .refine((fs) => new Set(fs.map((f) => f.name)).size === fs.length, 'field names must be unique'),
    display: z
      .object({
        position: z.enum(['inline', 'bottom-right', 'modal']).default('inline'),
        accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a #rrggbb colour').default('#2563eb'),
      })
      .strict()
      .default({}),
    active: z.boolean().default(true),
  })
  .strict();

export const widgetCreateSchema = widgetBase;
export const widgetUpdateSchema = widgetBase.partial().refine((o) => Object.keys(o).length > 0, 'at least one field is required');

export const registerSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).strict();

export const listQuerySchema = z.object({
  widgetId: z.string().max(64).optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const statsQuerySchema = z.object({
  widgetId: z.string().max(64).optional(),
  days: z.coerce.number().int().min(1).max(365).default(30),
});

// Envelope of POST /submissions. `hp` is the honeypot; it is deliberately untyped so a
// bot that fills it with anything still reaches the spam check instead of a 400.
export const submissionEnvelope = z
  .object({
    widgetId: z.string().min(1).max(64),
    data: z.record(z.string(), z.unknown()),
    hp: z.unknown().optional(),
  })
  .strict();

/** Per-widget schema built from the widget's own field definitions. Unknown keys are rejected. */
export function buildDataSchema(fields) {
  const shape = {};
  for (const f of fields) {
    let s = f.type === 'email' ? z.string().trim().max(254).email() : z.string().trim().max(f.type === 'textarea' ? 2000 : 200);
    if (f.required) s = s.min(1, 'is required');
    shape[f.name] = f.required ? s : z.preprocess((v) => (v === '' ? undefined : v), s.optional());
  }
  return z.object(shape).strict();
}

export function zodDetails(err) {
  return err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}
