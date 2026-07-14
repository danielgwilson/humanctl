// Mechanical color contract for the Registry-owned Humanctl token layer.
// This script has no color-library dependency. It parses authored oklch
// values, converts them to sRGB, composites alpha in gamma-encoded sRGB, and
// computes WCAG relative luminance and contrast.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CSS_PATH = path.join(SCRIPT_DIR, '..', 'packages', 'ui', 'src', 'styles', 'tokens.css');

type RGB = readonly [number, number, number];

interface ColorToken {
  name: string;
  rgb: RGB;
  rawRgb: RGB;
  alpha: number;
}

interface TokenSet {
  colors: Map<string, ColorToken>;
  aliases: Map<string, string>;
}

function oklchToLinearSrgb(lightness: number, chroma: number, hueDegrees: number): RGB {
  const hue = (hueDegrees * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const lPrime = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = lPrime ** 3;
  const m = mPrime ** 3;
  const s = sPrime ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function linearToGamma(channel: number): number {
  const sign = channel < 0 ? -1 : 1;
  const absolute = Math.abs(channel);
  return absolute <= 0.0031308
    ? 12.92 * channel
    : sign * (1.055 * absolute ** (1 / 2.4) - 0.055);
}

function oklchToSrgb(lightness: number, chroma: number, hueDegrees: number): RGB {
  const [red, green, blue] = oklchToLinearSrgb(lightness, chroma, hueDegrees);
  return [linearToGamma(red), linearToGamma(green), linearToGamma(blue)];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

const GAMUT_EPSILON = 0.0008;

function isInSrgbGamut(rgb: RGB): boolean {
  return rgb.every((channel) => channel >= -GAMUT_EPSILON && channel <= 1 + GAMUT_EPSILON);
}

function luminanceChannel(channel: number): number {
  const clamped = clamp01(channel);
  return clamped <= 0.03928 ? clamped / 12.92 : ((clamped + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance([red, green, blue]: RGB): number {
  return 0.2126 * luminanceChannel(red) + 0.7152 * luminanceChannel(green) + 0.0722 * luminanceChannel(blue);
}

function contrastRatio(first: RGB, second: RGB): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

function compositeSourceOver(source: RGB, alpha: number, destination: RGB): RGB {
  return [
    source[0] * alpha + destination[0] * (1 - alpha),
    source[1] * alpha + destination[1] * (1 - alpha),
    source[2] * alpha + destination[2] * (1 - alpha),
  ];
}

function extractBlock(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(^|\\n)\\s*${escaped}\\s*\\{`).exec(css);
  if (!match) throw new Error(`could not find ${selector} block in ${path.relative(process.cwd(), CSS_PATH)}`);
  const start = match.index + match[0].length;
  let depth = 1;
  let cursor = start;
  while (cursor < css.length && depth > 0) {
    if (css[cursor] === '{') depth += 1;
    if (css[cursor] === '}') depth -= 1;
    cursor += 1;
  }
  if (depth !== 0) throw new Error(`unterminated ${selector} block`);
  return css.slice(start, cursor - 1);
}

const OKLCH_DECLARATION = /--([a-z0-9-]+):\s*oklch\(\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+))?\s*\)\s*;/gi;
const ALIAS_DECLARATION = /--([a-z0-9-]+):\s*var\(--([a-z0-9-]+)\)\s*;/gi;

function parseTokenSet(block: string): TokenSet {
  const colors = new Map<string, ColorToken>();
  const aliases = new Map<string, string>();
  for (const match of block.matchAll(OKLCH_DECLARATION)) {
    const [, name, lightnessText, chromaText, hueText, alphaText] = match;
    const rawRgb = oklchToSrgb(Number(lightnessText), Number(chromaText), Number(hueText));
    colors.set(name, {
      name,
      rawRgb,
      rgb: [clamp01(rawRgb[0]), clamp01(rawRgb[1]), clamp01(rawRgb[2])],
      alpha: alphaText === undefined ? 1 : Number(alphaText),
    });
  }
  for (const match of block.matchAll(ALIAS_DECLARATION)) aliases.set(match[1], match[2]);
  return { colors, aliases };
}

function mergeTokenSets(base: TokenSet, overrides: TokenSet): TokenSet {
  return {
    colors: new Map([...base.colors, ...overrides.colors]),
    aliases: new Map([...base.aliases, ...overrides.aliases]),
  };
}

function resolve(tokens: TokenSet, name: string, seen = new Set<string>()): ColorToken {
  const color = tokens.colors.get(name);
  if (color) return color;
  if (seen.has(name)) throw new Error(`circular token alias at --${name}`);
  seen.add(name);
  const alias = tokens.aliases.get(name);
  if (!alias) throw new Error(`required color token --${name} is missing`);
  return resolve(tokens, alias, seen);
}

function paint(source: ColorToken, destination: RGB): RGB {
  return compositeSourceOver(source.rgb, source.alpha, destination);
}

let checks = 0;
let failures = 0;
const failureLines: string[] = [];

function report(label: string, value: number, minimum: number, strict = false): void {
  checks += 1;
  const passes = strict ? value > minimum + 1e-9 : value >= minimum - 1e-9;
  const line = `${passes ? 'PASS' : 'FAIL'}  ${label}: ${value.toFixed(3)} ${strict ? '>' : '>='} ${minimum.toFixed(3)}`;
  console.log(line);
  if (!passes) {
    failures += 1;
    failureLines.push(line);
  }
}

const css = readFileSync(CSS_PATH, 'utf8');
const darkBlock = extractBlock(css, ':root');
const lightBlock = extractBlock(css, '.light');
const darkAuthored = parseTokenSet(darkBlock);
const lightAuthored = parseTokenSet(lightBlock);
const themes = [
  { name: 'dark', tokens: darkAuthored },
  { name: 'light', tokens: mergeTokenSets(darkAuthored, lightAuthored) },
] as const;

if (darkAuthored.colors.size === 0 || lightAuthored.colors.size === 0) {
  throw new Error('token parser found no authored colors for one or more themes');
}
const authoredOklchCount = [darkBlock, lightBlock]
  .map((block) => block.match(/oklch\(/gi)?.length ?? 0)
  .reduce((total, count) => total + count, 0);
if (authoredOklchCount !== darkAuthored.colors.size + lightAuthored.colors.size) {
  throw new Error(`token parser read ${darkAuthored.colors.size + lightAuthored.colors.size} of ${authoredOklchCount} authored oklch declarations`);
}

console.log(`tokens:check: ${path.relative(process.cwd(), CSS_PATH)}`);
console.log(`parsed ${darkAuthored.colors.size} root colors and ${lightAuthored.colors.size} light overrides\n`);

console.log('-- authored oklch values in sRGB gamut --');
for (const [scope, tokenSet] of [['root', darkAuthored], ['light', lightAuthored]] as const) {
  for (const token of tokenSet.colors.values()) {
    checks += 1;
    const passes = isInSrgbGamut(token.rawRgb) && token.alpha >= 0 && token.alpha <= 1;
    if (!passes) {
      failures += 1;
      const line = `FAIL  [${scope}] --${token.name}: [${token.rawRgb.map((channel) => channel.toFixed(4)).join(', ')}]`;
      failureLines.push(line);
      console.log(line);
    }
  }
}
console.log(`INFO  ${darkAuthored.colors.size + lightAuthored.colors.size} authored colors inspected\n`);

const contentSurfaces = ['surface-0', 'surface-1', 'surface-2', 'surface-sunken'] as const;
const inkMinimums = { ink: 12, 'ink-2': 7, 'ink-3': 4.5, 'ink-4': 3 } as const;

console.log('-- ink ladder across content surfaces --');
for (const theme of themes) {
  for (const surfaceName of contentSurfaces) {
    const surface = resolve(theme.tokens, surfaceName);
    for (const [inkName, minimum] of Object.entries(inkMinimums)) {
      const ink = resolve(theme.tokens, inkName);
      report(`[${theme.name}] --${inkName} on --${surfaceName}`, contrastRatio(paint(ink, surface.rgb), surface.rgb), minimum);
    }
  }
}
console.log('');

const stateNames = ['work', 'need', 'block', 'done', 'idle'] as const;

console.log('-- semantic labels on soft state fills --');
for (const theme of themes) {
  for (const stateName of stateNames) {
    const label = resolve(theme.tokens, `${stateName}-contrast`);
    const soft = resolve(theme.tokens, `${stateName}-soft`);
    report(`[${theme.name}] --${stateName}-contrast on --${stateName}-soft`, contrastRatio(paint(label, soft.rgb), soft.rgb), 4.5);
  }
}
console.log('');

const actionFills = [
  { role: 'primary', token: 'accent-solid' },
  { role: 'destructive', token: 'block-solid' },
] as const;

console.log('-- action labels on rest, hover, and press fills --');
for (const theme of themes) {
  const label = resolve(theme.tokens, 'on-solid');
  const hover = resolve(theme.tokens, 'overlay-hover');
  const press = resolve(theme.tokens, 'overlay-press');
  for (const action of actionFills) {
    const solid = resolve(theme.tokens, action.token);
    const states = [
      ['rest', solid.rgb],
      ['hover', paint(hover, solid.rgb)],
      ['press', paint(press, solid.rgb)],
    ] as const;
    for (const [stateName, fill] of states) {
      report(`[${theme.name}] ${action.role} label (${stateName})`, contrastRatio(label.rgb, fill), 4.5);
    }
  }
}
console.log('');

console.log('-- focus ring against content surfaces --');
for (const theme of themes) {
  const ring = resolve(theme.tokens, 'ring');
  for (const surfaceName of contentSurfaces) {
    const surface = resolve(theme.tokens, surfaceName);
    report(`[${theme.name}] --ring on --${surfaceName}`, contrastRatio(paint(ring, surface.rgb), surface.rgb), 3);
  }
}
console.log('');

console.log('-- selected state outranks hover --');
for (const theme of themes) {
  const hover = resolve(theme.tokens, 'overlay-hover');
  const selected = resolve(theme.tokens, 'overlay-selected');
  for (const surfaceName of ['surface-0', 'surface-1', 'surface-2'] as const) {
    const surface = resolve(theme.tokens, surfaceName);
    const hoverFill = paint(hover, surface.rgb);
    const selectedFill = paint(selected, surface.rgb);
    const selectedHoverFill = paint(hover, selectedFill);
    const hoverContrast = contrastRatio(hoverFill, surface.rgb);
    const selectedContrast = contrastRatio(selectedFill, surface.rgb);
    report(`[${theme.name}] selected minus hover on --${surfaceName}`, selectedContrast - hoverContrast, 0.08);
    report(`[${theme.name}] selected plus hover above selected on --${surfaceName}`, contrastRatio(selectedHoverFill, surface.rgb), selectedContrast, true);
  }
}

console.log('\n' + '='.repeat(64));
if (failures > 0) {
  console.error(`tokens:check: ${failures} of ${checks} checks failed`);
  for (const line of failureLines) console.error(`  ${line}`);
  process.exitCode = 1;
} else {
  console.log(`tokens:check: ${checks} checks passed`);
}
