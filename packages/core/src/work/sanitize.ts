import type { UntrustedText } from './model.js';

// C0/C1 controls except \t \n \r, zero-width characters, bidi embeddings/overrides/isolates, BOM.
const STRIP =
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u{200B}-\u{200F}\u{202A}-\u{202E}\u{2060}-\u{2064}\u{2066}-\u{2069}\u{FEFF}]/gu;
const MD_IMAGE = /!\[([^\]]*)\]\([^)]*\)/g;
const MD_LINK = /\[([^\]]*)\]\([^)]*\)/g;
const SUSPICIOUS = [
  /\b(system|assistant|developer)\s*:/i,
  /<\|[a-z_]+\|>/i,
  /\bignore\s+(all\s+)?(the\s+)?(previous|prior|above)\b/i,
  /\bdisregard\s+(all\s+)?(the\s+)?(previous|prior|above)\b/i,
  /\byou\s+are\s+now\b/i,
];

export interface SanitizedText {
  value: UntrustedText;
  /** The text looks like it tries to instruct a model. It is kept, but the caller should warn. */
  suspicious: boolean;
}

/**
 * Sanitizes tracker text before it reaches a model (spec §9.1): strips control, zero-width and
 * bidi characters, flattens markdown links and images to their label, collapses whitespace,
 * and truncates. Instruction-like text is flagged, not removed, because removal is unreliable.
 */
export function sanitizeText(raw: string, maxChars: number): SanitizedText {
  const flattened = raw.replace(STRIP, '').replace(MD_IMAGE, '$1').replace(MD_LINK, '$1');
  const text = flattened.replace(/\s+/g, ' ').trim();
  const suspicious = SUSPICIOUS.some((re) => re.test(text));
  const chars = [...text];
  const truncated = chars.length > maxChars;
  return {
    value: {
      text: truncated ? chars.slice(0, Math.max(0, maxChars - 1)).join('') + '…' : text,
      untrusted: true,
      truncated,
    },
    suspicious,
  };
}
