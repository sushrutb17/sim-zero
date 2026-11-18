/**
 * Cheap night outside view (visual-direction.md section 7): gradient sky dome with stars, fog, ground, a wet
 * runway with code-generated markings and lights, two moonlit cloud layers and a storm cell lit from inside
 * by occasional lightning. No external textures, no shadows, no post-processing.
 * About 7 draw calls and under 2.5k triangles.
 * The view follows the flight (T37): on the ground it is the runway picture; after takeoff the ground and runway
 * fall away and are hidden, and the two cloud layers end up below the aircraft, drifting past.
 * The camera far plane is 200 m (iwsdk.config.json), so everything fades into fog by ~190 m.
 */
import {
  BackSide,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Fog,
  HemisphereLight,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
  createSystem,
  type World,
} from '@iwsdk/core';
import { THEME } from '../theme';

const DOME_RADIUS = 180;
const GROUND_RADIUS = 190;
/** Ground sits this far below the player origin (cockpit is a few metres above the runway). */
const GROUND_Y = -2;
const SKY_SEGMENTS = [16, 8] as const;
const STAR_COUNT = 320;
/** Lightning: seconds between flashes (min, extra range), decay time of one pulse, delay of the echo pulse. */
const FLASH_GAP_S = [6, 7] as const;
const FLASH_DECAY_S = 0.11;
const FLASH_ECHO_S = 0.2;
/** Seconds the outside view takes to go from the runway picture to the above-the-cloud picture after takeoff. */
export const CLIMB_OUT_S = 10;
/** Runway centre on the ground (z), and how far back it slides as the aircraft leaves it. */
const RUNWAY_Z = -100;
const RUNWAY_SLIDE = 300;
/** Ground and runway drop this far by the end of the climb-out: past the fog's far edge, where they are hidden. */
const GROUND_DROP = 200;
/** Cloud layer heights on the ground (dark undersides, then the lighter tops) and how far both sink in the climb. */
const CLOUD_Y = [38, 70] as const;
const CLOUD_SINK = 75;
/** Cloud texture scroll once airborne (texture units per second; one unit is about 127 m of cloud plane). */
const CLOUD_DRIFT = 0.2;

/** Deterministic pseudo-random stream (same sky every run, and in tests). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/**
 * Lightning brightness (0..1) at time t for a flash that started at t0: one sharp pulse and a weaker echo.
 * Two pulses per flash and at least FLASH_GAP_S[0] seconds between flashes keeps it far below 3 flashes/second.
 */
export function flashLevel(t: number, t0: number): number {
  const dt = t - t0;
  if (dt < 0) return 0;
  const a = Math.exp(-dt / FLASH_DECAY_S);
  const b = dt >= FLASH_ECHO_S ? 0.6 * Math.exp(-(dt - FLASH_ECHO_S) / FLASH_DECAY_S) : 0;
  return Math.min(1, Math.max(a, b));
}

/** Start time of the flash after one that started at t0 (r in 0..1). */
export function nextFlashAt(t0: number, r: number): number {
  return t0 + FLASH_GAP_S[0] + r * FLASH_GAP_S[1];
}

export interface OutsidePose {
  /** Height of the ground disc; the runway sits 2 cm above it. */
  groundY: number;
  runwayZ: number;
  /** False once the ground has dropped into the fog: the ground and runway are then not drawn. */
  groundVisible: boolean;
  /** Heights of the two cloud planes (same order as CLOUD_Y). */
  cloudY: [number, number];
}

/**
 * The outside picture for an airborne level `a`: 0 = on the ground (the picture before T37), 1 = established above
 * both cloud layers. In between, the ground falls away slowly at first (a squared) and the runway slides behind,
 * while the cloud layers sink past the aircraft (smoothstep), the dark layer first.
 * Pass `out` to reuse one object (the per-frame caller does, so the climb-out allocates nothing).
 */
export function outsidePose(a: number, out: OutsidePose = { groundY: 0, runwayZ: 0, groundVisible: true, cloudY: [0, 0] }): OutsidePose {
  const t = Math.min(1, Math.max(0, a));
  const sink = CLOUD_SINK * t * t * (3 - 2 * t);
  out.groundY = GROUND_Y - GROUND_DROP * t * t;
  out.runwayZ = RUNWAY_Z + RUNWAY_SLIDE * t;
  out.groundVisible = t < 1;
  out.cloudY[0] = CLOUD_Y[0] - sink;
  out.cloudY[1] = CLOUD_Y[1] - sink;
  return out;
}

/**
 * Next airborne level after `dtSec`: climbs to 1 over CLIMB_OUT_S while airborne. The scenario has no landing, so a
 * return to the ground is always a reset (restart, redo of a ground Event Set) and the picture snaps back.
 */
export function nextAirborneLevel(level: number, airborne: boolean, dtSec: number): number {
  if (!airborne) return 0;
  return Math.min(1, level + Math.max(0, dtSec) / CLIMB_OUT_S);
}

const CLOUD_SIZE = 1024;
const CLOUD_BLOBS = 150;

/**
 * Wrap offsets (ox, oy) in {-size, 0, size}^2 whose copy of a blob at (x, y) with radius r touches the canvas.
 * A copy whose square [x+ox-r, x+ox+r] x [y+oy-r, y+oy+r] lies fully outside [0, size]^2 draws nothing, so it is skipped.
 */
export function cloudTileOffsets(x: number, y: number, r: number, size: number = CLOUD_SIZE): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const ox of [-size, 0, size]) {
    if (x + ox + r <= 0 || x + ox - r >= size) continue;
    for (const oy of [-size, 0, size]) {
      if (y + oy + r <= 0 || y + oy - r >= size) continue;
      out.push([ox, oy]);
    }
  }
  return out;
}

/** The slice of CanvasRenderingContext2D that paintClouds uses (lets a test inject a counting fake). */
export interface CloudContext {
  clearRect(x: number, y: number, w: number, h: number): void;
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): { addColorStop(offset: number, color: string): void };
  fillStyle: unknown;
  fillRect(x: number, y: number, w: number, h: number): void;
}

/** Paints the tiling cloud-density blobs (white, alpha = density). Deterministic: identical every run. */
export function paintClouds(g: CloudContext, size: number = CLOUD_SIZE): void {
  g.clearRect(0, 0, size, size);
  // deterministic pseudo-random so the texture is identical every run
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < CLOUD_BLOBS; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 40 + rnd() * 110;
    const a = 0.25 + rnd() * 0.45;
    for (const [ox, oy] of cloudTileOffsets(x, y, r, size)) {
      const grad = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      grad.addColorStop(0, `rgba(255,255,255,${a})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  }
}

/** One 1024x1024 generated cloud-density texture shared by both layers. */
function cloudTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = CLOUD_SIZE;
  c.height = CLOUD_SIZE;
  paintClouds(c.getContext('2d')!);
  const t = new CanvasTexture(c);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.repeat.set(3, 3);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export interface Outside {
  /** Two cloud planes (lower = dark undersides, upper = cloud tops) for Task 11 to drift via texture offset. */
  clouds: Mesh[];
  setStormVisible(visible: boolean): void;
  storm: Mesh;
  /** Where the picture is between the runway (0) and above the cloud (1), and whether the ground and runway are drawn. */
  flight(): { level: number; groundVisible: boolean };
}

/** Stars on the upper sky, seen through the gaps in the cloud layers. One draw call. */
function stars(): Points {
  const rnd = lcg(20261110);
  const arr = new Float32Array(STAR_COUNT * 3);
  for (let i = 0; i < STAR_COUNT; i++) {
    const az = rnd() * Math.PI * 2;
    const el = 0.06 + rnd() * 1.3; // radians above the horizon
    const r = DOME_RADIUS - 6;
    arr[i * 3] = r * Math.cos(el) * Math.cos(az);
    arr[i * 3 + 1] = r * Math.sin(el);
    arr[i * 3 + 2] = r * Math.cos(el) * Math.sin(az);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(arr, 3));
  const m = new Points(g, new PointsMaterial({ color: new Color(THEME.outside.star), size: 1.6, sizeAttenuation: false, fog: false, depthWrite: false, toneMapped: false }));
  m.name = 'outside:stars';
  m.renderOrder = -9; // after the dome, before the clouds (which do not write depth)
  m.frustumCulled = false;
  return m;
}

function skyDome(): Mesh {
  const g = new SphereGeometry(DOME_RADIUS, SKY_SEGMENTS[0], SKY_SEGMENTS[1]);
  const pos = g.attributes.position;
  const zenith = new Color(THEME.outside.zenith);
  const haze = new Color(THEME.outside.horizonHaze);
  const tmp = new Color();
  const colors: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, pos.getY(i) / DOME_RADIUS)); // 0 at horizon, 1 at zenith
    tmp.copy(haze).lerp(zenith, Math.pow(t, 0.6));
    colors.push(tmp.r, tmp.g, tmp.b);
  }
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const m = new Mesh(g, new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false, toneMapped: false }));
  m.name = 'outside:sky';
  m.renderOrder = -10;
  m.frustumCulled = false;
  return m;
}

function runwayTexture(): CanvasTexture {
  // Along-the-runway axis is u: 1024 x 256 (the maximum the visual direction allows).
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = THEME.outside.runway;
  g.fillRect(0, 0, 1024, 256);
  g.fillStyle = THEME.outside.runwayMark;
  for (let x = 40; x < 1024; x += 120) g.fillRect(x, 124, 64, 8); // centreline dashes
  g.fillRect(0, 8, 1024, 4); // edge lines
  g.fillRect(0, 244, 1024, 4);
  for (let i = 0; i < 6; i++) g.fillRect(8, 30 + i * 36, 56, 14); // threshold bars
  // faint wet-sheen streak
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.06)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 256);
  // lights: each is a soft dot with a short reflection on the wet surface (the material is unlit, so they glow)
  const dot = (x: number, y: number, r: number, hex: string) => {
    const c2 = new Color(hex);
    const rgb = `${Math.round(c2.r * 255)},${Math.round(c2.g * 255)},${Math.round(c2.b * 255)}`;
    const halo = g.createRadialGradient(x, y, 0, x, y, r);
    halo.addColorStop(0, `rgba(${rgb},1)`);
    halo.addColorStop(0.35, `rgba(${rgb},0.55)`);
    halo.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = halo;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  };
  for (let x = 20; x < 1024; x += 60) {
    dot(x, 10, 9, THEME.outside.runwayLight); // edge lights
    dot(x, 246, 9, THEME.outside.runwayLight);
  }
  for (let x = 72; x < 1024; x += 120) dot(x, 128, 5, THEME.outside.runwayLight); // centreline lights
  for (let i = 0; i < 8; i++) dot(6, 24 + i * 30, 8, THEME.outside.runwayThreshold); // threshold bar
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** About 8 flat-shaded icosahedra merged into one non-indexed mesh. */
function stormGeometry(): BufferGeometry {
  const blobs: Array<[number, number, number, number]> = [
    [0, 0, 0, 14], [12, 3, 4, 10], [-11, 2, 3, 11], [4, 11, -2, 9],
    [-5, 9, 4, 8], [16, -2, -5, 7], [-16, -1, -4, 8], [0, 16, 0, 6],
  ];
  const parts = blobs.map(([x, y, z, r]) => {
    const g = new IcosahedronGeometry(r, 0).toNonIndexed();
    g.translate(x, y, z);
    return g;
  });
  const total = parts.reduce((n, p) => n + p.attributes.position.count, 0);
  const arr = new Float32Array(total * 3);
  let o = 0;
  for (const p of parts) {
    arr.set(p.attributes.position.array as Float32Array, o);
    o += p.attributes.position.array.length;
    p.dispose();
  }
  const merged = new BufferGeometry();
  merged.setAttribute('position', new Float32BufferAttribute(arr, 3));
  merged.computeVertexNormals();
  return merged;
}

let lightning: ((timeS: number) => void) | undefined;
let follow: ((dtSec: number) => void) | undefined;
let isAirborne: (() => boolean) | undefined;

/** Tell the outside view where to read "the aircraft has left the ground" (src/index.ts: the engine's flight phase). */
export function setOutsideFlight(airborne: () => boolean): void {
  isAirborne = airborne;
}

/**
 * Drives the storm cell's lightning and the ground-to-cruise picture. Register it in src/index.ts; it does nothing
 * until createOutside has run.
 */
export class OutsideSystem extends createSystem({}) {
  update(delta: number, time: number): void {
    lightning?.(time);
    follow?.(delta);
  }
}

export function createOutside(world: World): Outside {
  world.scene.fog = new Fog(new Color(THEME.outside.horizonHaze), 30, GROUND_RADIUS - 5);

  const sky = skyDome();
  world.createTransformEntity(sky);

  const ground = new Mesh(
    new CircleGeometry(GROUND_RADIUS, 24),
    new MeshLambertMaterial({ color: new Color(THEME.color.ground) }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = GROUND_Y;
  ground.name = 'outside:ground';
  world.createTransformEntity(ground);

  const runway = new Mesh(
    new PlaneGeometry(170, 30).rotateX(-Math.PI / 2).rotateY(Math.PI / 2),
    new MeshBasicMaterial({ map: runwayTexture(), toneMapped: false }),
  );
  runway.position.set(0, GROUND_Y + 0.02, RUNWAY_Z);
  runway.name = 'outside:runway';
  world.createTransformEntity(runway);

  world.createTransformEntity(stars());

  // Storm cell off the nose to the right: a faceted moonlit mass (not fogged, so it reads against the night sky)
  // whose emissive colour is driven by OutsideSystem for lightning. Only the cell brightens, never the scene.
  const stormMat = new MeshLambertMaterial({
    color: new Color(THEME.outside.storm),
    emissive: new Color(THEME.outside.stormFlash),
    emissiveIntensity: 0,
    flatShading: true,
    fog: false,
  });
  const storm = new Mesh(stormGeometry(), stormMat);
  storm.position.set(70, 14, -150);
  storm.name = 'outside:storm';
  world.createTransformEntity(storm);
  const rnd = lcg(214);
  let flashAt = 4;
  lightning = (timeS) => {
    if (!storm.visible) return;
    if (timeS > flashAt + 1.5) flashAt = nextFlashAt(timeS, rnd());
    stormMat.emissiveIntensity = THEME.outside.stormFlashPeak * flashLevel(timeS, flashAt);
  };

  // Two cloud layers share ONE texture; alphaTest cutouts, no sorting issues, fogged into the haze.
  const cloudTex = cloudTexture();
  const clouds: Mesh[] = [];
  for (const [y, hex] of [[CLOUD_Y[0], THEME.outside.cloudDark], [CLOUD_Y[1], THEME.outside.cloud]] as const) {
    // DoubleSide: the planes face down, and after takeoff they are seen from above.
    const m = new Mesh(
      new PlaneGeometry(380, 380).rotateX(Math.PI / 2),
      new MeshBasicMaterial({ map: cloudTex, color: new Color(hex), alphaTest: 0.35, depthWrite: false, toneMapped: false, side: DoubleSide }),
    );
    m.position.set(0, y, -40);
    m.name = `outside:clouds:${y}`;
    world.createTransformEntity(m);
    clouds.push(m);
  }

  // Ground-to-cruise picture (T37). Nothing is written while the level is steady; the only per-frame work in the
  // air is one texture-offset write for the cloud drift (v runs along +z, so a falling offset moves cloud aft).
  let level = 0;
  const pose = outsidePose(0);
  follow = (dtSec) => {
    const next = nextAirborneLevel(level, isAirborne?.() ?? false, dtSec);
    if (next !== level) {
      level = next;
      outsidePose(level, pose);
      ground.position.y = pose.groundY;
      runway.position.y = pose.groundY + 0.02;
      runway.position.z = pose.runwayZ;
      ground.visible = pose.groundVisible;
      runway.visible = pose.groundVisible;
      clouds[0].position.y = pose.cloudY[0];
      clouds[1].position.y = pose.cloudY[1];
    }
    if (level > 0) cloudTex.offset.y = (((cloudTex.offset.y - CLOUD_DRIFT * level * dtSec) % 1) + 1) % 1;
    else if (cloudTex.offset.y !== 0) cloudTex.offset.y = 0;
  };

  // Lighting per visual direction section 3: one hemisphere + one directional (moonlight through the windscreen),
  // no shadows. Tokens in THEME.light.
  const hemi = new HemisphereLight(new Color(THEME.light.hemiSky), new Color(THEME.light.hemiGround), THEME.light.hemiIntensity);
  world.createTransformEntity(hemi);
  const sun = new DirectionalLight(new Color(THEME.light.sunColor), THEME.light.sunIntensity);
  sun.position.set(0, 3, -4);
  sun.castShadow = false;
  world.createTransformEntity(sun);

  return { clouds, storm, setStormVisible: (v) => (storm.visible = v), flight: () => ({ level, groundVisible: ground.visible && runway.visible }) };
}
