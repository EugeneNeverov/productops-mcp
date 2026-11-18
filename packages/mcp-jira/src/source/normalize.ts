import { createHash } from 'node:crypto';
import { sanitizeText, type JiraConfig, type UntrustedText } from '@productops-mcp/core';
import type { Session } from './types.js';

/** Shared by every source: people privacy and untrusted-text sanitizing (spec §6.2, §9.1). */
export class Normalizer {
  constructor(private readonly config: Pick<JiraConfig, 'people' | 'returnText'>) {}

  person(name: string | null | undefined, accountId?: string | null): string | null {
    if (!name) return null;
    switch (this.config.people) {
      case 'none':
        return null;
      case 'hashed':
        return (
          'person-' +
          createHash('sha256')
            .update(accountId ?? name)
            .digest('hex')
            .slice(0, 8)
        );
      default:
        return name;
    }
  }

  text(raw: string, key: string, session: Session): UntrustedText {
    const { value, suspicious } = sanitizeText(raw, this.config.returnText.maxChars);
    if (suspicious) session.suspiciousKeys.add(key);
    return value;
  }
}
