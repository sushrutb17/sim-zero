/**
 * THEME: the single source of visual and sound tokens for every XR task (8-11, 15).
 * Rationale, contrast figures and usage rules: docs/design/visual-direction.md.
 * Direction: "Night Departure" lighting on the original layout (user decision 2026-11-10, task T21).
 * Emulator-checked only; headset legibility of the dark panels is not verified.
 *
 * Plain constants only (no @iwsdk/core / three imports) so headless tests and the
 * instructor console can import it. Do not hard-code colours, text sizes or gains
 * elsewhere; add a token here (and to the design doc) instead.
 */

export type SfxName = 'click' | 'alertWarning' | 'alertCaution' | 'chime' | 'ambient' | 'radioIn';

export interface SfxToken {
  /** Absolute URL path under /audio/sfx/. Files are produced in Task 12. */
  file: string;
  /** Gain relative to the master bus, in dB (0 = full scale). */
  gainDb: number;
}

export interface Theme {
  /** Core palette (sRGB hex). */
  color: {
    panel: string;
    panelEdge: string;
    bezel: string;
    text: string;
    textDim: string;
    hover: string;
    pressed: string;
    /** Flat fill (canvas panels) for a hovered reply card / route row. Light text stays >= 4.5:1. */
    hoverFill: string;
    /** Flat fill for the press flash of a card / row. */
    pressedFill: string;
    accent: string;
    sky: string;
    ground: string;
  };
  /** Alert convention: warning = red, caution = amber, advisory = cyan. All ≥ 4.5:1 on color.panel. */
  alert: { warning: string; caution: string; advisory: string };
  text: {
    /** 'builtin:inter' = the UI kit's bundled Inter MSDF (@pmndrs/msdfonts, SIL OFL 1.1). ASCII + ° only. */
    fontUrl: string;
    /** Minimum cap height in metres, derived for 0.6 m viewing distance (visual-direction.md §4). */
    minHeightM: number;
    /** Inter cap height as a fraction of the em: fontSize = capHeight / capToEm. */
    capToEm: number;
    /** Cap heights per text role, in metres. */
    capM: { min: number; body: number; readout: number; title: number };
  };
  control: {
    minHitM: 0.035;
    pressTravelM: 0.004;
    /** Emissive intensity of THEME.color.hover while hovered. */
    hoverEmissive: number;
    /** Emissive intensity of THEME.color.pressed during the press flash. */
    pressedEmissive: number;
    /** Duration of the press flash, in ms. */
    pressFlashMs: number;
  };
  sfx: Record<SfxName, SfxToken>;
  /** Self-lit display colours. */
  display: {
    bg: string;
    normal: string;
    route: string;
    adiSky: string;
    adiGround: string;
    wxLight: string;
    wxMid: string;
    wxHeavy: string;
    /** Soft light a display spills onto the dark cockpit around it (one additive mesh, no bloom). */
    glow: string;
    /** Peak opacity of that glow, 0..1. */
    glowOpacity: number;
  };
  /** Kneeboard printouts. */
  paper: { paper: string; ink: string; accentInk: string };
  /** Outside view. */
  outside: {
    horizonHaze: string;
    zenith: string;
    cloud: string;
    cloudDark: string;
    storm: string;
    stormCore: string;
    runway: string;
    runwayMark: string;
    /** Stars (points seen through gaps in the cloud). */
    star: string;
    /** Lightning inside the storm cell: the cell's emissive colour during a flash. Never a full-field flash. */
    stormFlash: string;
    /** Peak emissive intensity of a lightning flash on the storm cell. */
    stormFlashPeak: number;
    /** Runway edge and centreline lights / threshold lights. */
    runwayLight: string;
    runwayThreshold: string;
  };
  /**
   * Scene lights (visual-direction.md section 3). three r181 Lambert: outgoing = albedo / PI x irradiance,
   * so hemiIntensity is ~PI / (mean sky-ground mix) to let a panel face read close to its token colour.
   */
  light: {
    hemiSky: string;
    hemiGround: string;
    hemiIntensity: number;
    sunColor: string;
    sunIntensity: number;
  };
  /** Radio voice treatment (Task 12). */
  radio: {
    voiceGainDb: number;
    bandLowHz: number;
    bandHighHz: number;
    compressorRatio: number;
    compressorAttackS: number;
    compressorReleaseS: number;
    hissDb: number;
    ambientDuckDb: number;
    /** Lighter "interphone" treatment for cabin crew lines. */
    cabinBandLowHz: number;
    cabinBandHighHz: number;
  };
}

/** Inter: capHeight 1490 / unitsPerEm 2048 (also measured from the MSDF 'H': 32 px ink at 44 px em). */
const CAP_TO_EM = 0.727;

function deepFreeze<T>(o: T): Readonly<T> {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

export const THEME: Readonly<Theme> = deepFreeze<Theme>({
  color: {
    panel: '#111722',
    panelEdge: '#2A3344',
    bezel: '#07090D',
    text: '#F4E3C3',
    textDim: '#BDB198',
    hover: '#8B7CFF',
    pressed: '#C4B8FF',
    hoverFill: '#383A62',
    pressedFill: '#505187',
    accent: '#A08CFF',
    sky: '#1E2A5A',
    ground: '#0A101C',
  },
  alert: {
    warning: '#FF5C52',
    caution: '#FFB547',
    advisory: '#5FD7E6',
  },
  text: {
    fontUrl: 'builtin:inter',
    // 14 px cap at a conservative 20 px/deg = 0.70 deg; at 0.6 m: 2 * 0.6 * tan(0.35 deg) = 7.33 mm, rounded up.
    minHeightM: 0.0075,
    capToEm: CAP_TO_EM,
    capM: { min: 0.0075, body: 0.009, readout: 0.012, title: 0.015 },
  },
  control: {
    minHitM: 0.035,
    pressTravelM: 0.004,
    hoverEmissive: 0.35,
    pressedEmissive: 0.8,
    pressFlashMs: 120,
  },
  sfx: {
    click: { file: '/audio/sfx/click.mp3', gainDb: -12 },
    alertWarning: { file: '/audio/sfx/alertWarning.mp3', gainDb: -6 },
    alertCaution: { file: '/audio/sfx/alertCaution.mp3', gainDb: -9 },
    chime: { file: '/audio/sfx/chime.mp3', gainDb: -10 },
    ambient: { file: '/audio/sfx/ambient.mp3', gainDb: -24 },
    radioIn: { file: '/audio/sfx/radioIn.mp3', gainDb: -14 },
  },
  display: {
    bg: '#04060A',
    normal: '#5EDB8A',
    route: '#E47BE0',
    adiSky: '#2D5B85',
    adiGround: '#6A4C30',
    wxLight: '#3FBF6A',
    wxMid: '#E6B43C',
    wxHeavy: '#E5483F',
    glow: '#7F96D8',
    glowOpacity: 0.18,
  },
  paper: { paper: '#EFE9DC', ink: '#22262C', accentInk: '#5B47D6' },
  outside: {
    horizonHaze: '#1E2A5A',
    zenith: '#050818',
    cloud: '#3A4880',
    cloudDark: '#131936',
    storm: '#2B3266',
    stormCore: '#161B3C',
    runway: '#12151A',
    runwayMark: '#8F8B82',
    star: '#E9ECFF',
    stormFlash: '#DCD9FF',
    stormFlashPeak: 0.9,
    runwayLight: '#FFD9A0',
    runwayThreshold: '#63E6A0',
  },
  light: {
    // Night: the hemisphere keeps its calibrated strength (panels read close to their token colour); the look
    // comes from the dark palette, a cool moonlit sky colour and a faint warm bounce from the instruments below.
    hemiSky: '#C2CCEA',
    hemiGround: '#33291F',
    hemiIntensity: 6,
    sunColor: '#AFC0FF',
    sunIntensity: 0.8,
  },
  radio: {
    voiceGainDb: 0,
    bandLowHz: 300,
    bandHighHz: 3400,
    compressorRatio: 4,
    compressorAttackS: 0.003,
    compressorReleaseS: 0.08,
    hissDb: -36,
    ambientDuckDb: -6,
    cabinBandLowHz: 200,
    cabinBandHighHz: 5000,
  },
});

/** Font size (em, metres) for a desired cap height (metres). */
export function fontSizeForCap(capHeightM: number): number {
  return capHeightM / THEME.text.capToEm;
}
