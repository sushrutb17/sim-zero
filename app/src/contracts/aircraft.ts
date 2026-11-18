// FROZEN CONTRACT (Task 2). Changes need lead approval — see docs/progress/README.md.
// Plain TypeScript + zod only: no @iwsdk/core imports, so the engine runs headless in Node.
import { z } from 'zod';

export const CONTROL_IDS = [
  'ap.hdg', 'ap.alt', 'ap.engage', 'ap.lateral', 'ap.vertical', 'baro.set',
  'lights.landing', 'lights.strobe',
  'elec.gen1', 'elec.gen2', 'elec.busTie',
  'radio.com1', 'route.destination', 'pa.cabin', 'practice.toggle',
] as const;
export type ControlId = (typeof CONTROL_IDS)[number];
export const ControlIdSchema = z.enum(CONTROL_IDS);

/** The value type each control emits. Used to validate PilotActions and scenario matches. */
export const CONTROL_VALUE_SCHEMAS: Readonly<Record<ControlId, z.ZodType>> = Object.freeze({
  'ap.hdg': z.number().min(0).max(360),
  'ap.alt': z.number().min(0),
  'ap.engage': z.boolean(),
  'ap.lateral': z.enum(['hdg', 'nav']),
  'ap.vertical': z.enum(['climb', 'hold']),
  'baro.set': z.number(),
  'lights.landing': z.boolean(),
  'lights.strobe': z.boolean(),
  'elec.gen1': z.boolean(),
  'elec.gen2': z.boolean(),
  'elec.busTie': z.boolean(),
  'radio.com1': z.string().min(1),
  'route.destination': z.string().min(1), // an airport id from the scenario
  'pa.cabin': z.boolean(),
  'practice.toggle': z.boolean(),
});

/** Generator health. A generator is online when `switchOn && !failed`. */
export const GenStateSchema = z.strictObject({ switchOn: z.boolean(), failed: z.boolean() });
export type GenState = z.infer<typeof GenStateSchema>;

const ApSchema = z.strictObject({
  engaged: z.boolean(),
  hdg: z.number(),
  alt: z.number(),
  lateral: z.enum(['hdg', 'nav']),
  vertical: z.enum(['climb', 'hold']),
});
const LightsSchema = z.strictObject({ landing: z.boolean(), strobe: z.boolean() });
const ElecSchema = z.strictObject({
  gen1: GenStateSchema,
  gen2: GenStateSchema,
  backupGenInop: z.boolean(),
  busTie: z.boolean(),
});

export const AircraftStateSchema = z.strictObject({
  altitudeFt: z.number(),
  headingDeg: z.number(),
  speedKt: z.number(),
  phase: z.enum(['holding', 'takeoff', 'climb', 'cruise']),
  ap: ApSchema,
  baroHpa: z.number(),
  lights: LightsSchema,
  elec: ElecSchema,
  comFreq: z.string(),
  destination: z.string(),
  stormBearingDeg: z.number().nullable(),
});
export type AircraftState = z.infer<typeof AircraftStateSchema>;

/**
 * Deep partial. Task 3's applyPatch performs a DEEP merge, so
 * `{ elec: { gen1: { failed: true } } }` keeps `gen1.switchOn` and every sibling.
 */
export const AircraftPatchSchema = z.strictObject({
  altitudeFt: z.number().optional(),
  headingDeg: z.number().optional(),
  speedKt: z.number().optional(),
  phase: AircraftStateSchema.shape.phase.optional(),
  ap: ApSchema.partial().optional(),
  baroHpa: z.number().optional(),
  lights: LightsSchema.partial().optional(),
  elec: z
    .strictObject({
      gen1: GenStateSchema.partial().optional(),
      gen2: GenStateSchema.partial().optional(),
      backupGenInop: z.boolean().optional(),
      busTie: z.boolean().optional(),
    })
    .optional(),
  comFreq: z.string().optional(),
  destination: z.string().optional(),
  stormBearingDeg: z.number().nullable().optional(),
});
export type AircraftPatch = z.infer<typeof AircraftPatchSchema>;

/** Every leaf path in AircraftState (e.g. `elec.gen1.failed`) → its schema; validates `state` conditions. */
function leaves(schema: z.ZodType, prefix = ''): [string, z.ZodType][] {
  const shape = (schema as { shape?: Record<string, z.ZodType> }).shape;
  if (!shape) return [[prefix, schema]];
  return Object.entries(shape).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
}
export const AIRCRAFT_LEAVES: ReadonlyMap<string, z.ZodType> = new Map(leaves(AircraftStateSchema));
export const AIRCRAFT_PATHS: ReadonlySet<string> = new Set(AIRCRAFT_LEAVES.keys());
