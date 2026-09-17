import {
  type Bubble,
  Bubble as BubbleSchema,
  type BubbleType,
  type LetteringDefaults,
  type LetteringStyle,
  type SfxDefaults,
  type SfxStyle,
} from "@openmanga/schemas";
import { measureText, wrapText } from "./text.ts";

type FullStyle = Required<LetteringStyle>;

export const BUILTIN_LETTERING: {
  autoPlace: boolean;
  autoFit: boolean;
  maxWidth: number;
  types: Record<BubbleType, FullStyle>;
  sfx: Required<SfxDefaults>;
} = {
  autoPlace: false,
  autoFit: true,
  maxWidth: 0.42,
  types: {
    normal: {
      font: "Comic Neue",
      fontSize: 34,
      lineHeight: 1.15,
      align: "center",
      padding: 14,
      background: "#ffffff",
      textColor: "#111111",
      borderColor: "#111111",
      borderWidth: 3,
    },
    thought: {
      font: "Comic Neue",
      fontSize: 32,
      lineHeight: 1.15,
      align: "center",
      padding: 16,
      background: "#ffffff",
      textColor: "#111111",
      borderColor: "#111111",
      borderWidth: 3,
    },
    shout: {
      font: "Comic Neue",
      fontSize: 38,
      lineHeight: 1.1,
      align: "center",
      padding: 14,
      background: "#ffffff",
      textColor: "#111111",
      borderColor: "#111111",
      borderWidth: 4,
    },
    whisper: {
      font: "Comic Neue",
      fontSize: 30,
      lineHeight: 1.15,
      align: "center",
      padding: 14,
      background: "#ffffff",
      textColor: "#333333",
      borderColor: "#444444",
      borderWidth: 2,
    },
    narration: {
      font: "Comic Neue",
      fontSize: 30,
      lineHeight: 1.2,
      align: "left",
      padding: 12,
      background: "#fff8e1",
      textColor: "#111111",
      borderColor: "#111111",
      borderWidth: 2,
    },
    system: {
      font: "DejaVu Sans",
      fontSize: 28,
      lineHeight: 1.2,
      align: "left",
      padding: 12,
      background: "#eef4ff",
      textColor: "#0b1b4d",
      borderColor: "#1d42d8",
      borderWidth: 2,
    },
  },
  sfx: { font: "DejaVu Sans", fontSize: 90, fill: "#ffdd00", stroke: "#111111", strokeWidth: 7, opacity: 1 },
};

/** Project defaults merged over built-ins (projects created before lettering settings existed have none). */
export function resolveLettering(settings: { lettering?: LetteringDefaults } | null | undefined) {
  const l = settings?.lettering ?? {};
  const types = Object.fromEntries(
    (Object.keys(BUILTIN_LETTERING.types) as BubbleType[]).map((t) => [
      t,
      { ...BUILTIN_LETTERING.types[t], ...stripUndefined(l.types?.[t] ?? {}) },
    ]),
  ) as Record<BubbleType, FullStyle>;
  return {
    autoPlace: l.autoPlace ?? BUILTIN_LETTERING.autoPlace,
    autoFit: l.autoFit ?? BUILTIN_LETTERING.autoFit,
    maxWidth: l.maxWidth ?? BUILTIN_LETTERING.maxWidth,
    types,
    sfx: { ...BUILTIN_LETTERING.sfx, ...stripUndefined(l.sfx ?? {}) },
  };
}
export type ResolvedLettering = ReturnType<typeof resolveLettering>;

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

const ELLIPSE_TYPES = new Set<BubbleType>(["normal", "thought", "whisper", "shout"]);
/** Horizontal text inset used by layoutBubbleText for rounded bubble types. */
export const bubbleTextInset = (type: BubbleType) => (ELLIPSE_TYPES.has(type) ? 0.15 : 0);
/** Share of an outline's height usable for text (ellipses lose the curved top/bottom). */
const verticalUsable = (type: BubbleType) =>
  type === "shout" ? 0.66 : type === "thought" ? 0.68 : ELLIPSE_TYPES.has(type) ? 0.74 : 1;
/** Real fonts render a little wider than the estimate; keep glyphs inside the box. */
const WIDTH_SAFETY = 1.08;

/**
 * Smallest box (normalized to the page) that fits the text on as few lines as possible, never wider than
 * maxWidth of the page. The result wraps identically in the editor and the exporter (both use wrapText).
 */
export function fitBubbleBox(
  text: string,
  b: Bubble,
  pageW: number,
  pageH: number,
  maxWidth = BUILTIN_LETTERING.maxWidth,
) {
  const inset = bubbleTextInset(b.type);
  const maxBoxW = Math.max(40, maxWidth * pageW);
  const maxTextW = Math.max(10, maxBoxW * (1 - inset) - b.padding * 2);
  const lines = wrapText(text || " ", maxTextW / WIDTH_SAFETY, b.fontSize);
  const textW = Math.max(b.fontSize * 1.5, ...lines.map((l) => measureText(l, b.fontSize))) * WIDTH_SAFETY;
  const boxW = Math.min(pageW, (textW + b.padding * 2) / (1 - inset) + 2);
  const blockH = lines.length * b.fontSize * b.lineHeight;
  const boxH = Math.min(pageH, (blockH + b.padding * 2) / verticalUsable(b.type) + 2);
  return { width: Math.min(1, boxW / pageW), height: Math.min(1, boxH / pageH) };
}

/** Apply type defaults (style fields only) to a bubble. */
export function applyTypeStyle(b: Bubble, lettering: ResolvedLettering, type: BubbleType = b.type): Bubble {
  const st = lettering.types[type];
  const boxed = type === "narration" || type === "system";
  return { ...b, ...st, type, tail: boxed ? false : b.tail };
}

/** Resize keeping the anchor: rounded bubbles keep their center, boxes keep their top-left corner. */
export function refitBubble(text: string, b: Bubble, pageW: number, pageH: number, maxWidth?: number): Bubble {
  const size = fitBubbleBox(text, b, pageW, pageH, maxWidth);
  const boxed = b.type === "narration" || b.type === "system";
  const x = boxed ? b.x : b.x + b.width / 2 - size.width / 2;
  const y = boxed ? b.y : b.y + b.height / 2 - size.height / 2;
  return {
    ...b,
    ...size,
    x: Math.min(1 - size.width, Math.max(0, x)),
    y: Math.min(1 - size.height, Math.max(0, y)),
  };
}

export function applySfxDefaults(style: SfxStyle, lettering: ResolvedLettering): SfxStyle {
  return { ...style, ...lettering.sfx, scale: 1 };
}

/**
 * A new bubble of the given type: project style defaults + size fitted to its text (capped to the panel width).
 * Geometry is a placeholder until placed; pass `size` to placeBubble.
 */
export function draftBubble(
  text: string,
  type: BubbleType,
  lettering: ResolvedLettering,
  pageW: number,
  pageH: number,
  panelWidth = 1,
): { bubble: Bubble; size: { width: number; height: number } } {
  const bubble = BubbleSchema.parse({
    x: 0,
    y: 0,
    width: 0.2,
    height: 0.1,
    ...lettering.types[type],
    type,
    tail: type !== "narration" && type !== "system",
  });
  const size = fitBubbleBox(text, bubble, pageW, pageH, Math.min(lettering.maxWidth, Math.max(0.1, panelWidth * 0.92)));
  return { bubble: { ...bubble, ...size }, size };
}
