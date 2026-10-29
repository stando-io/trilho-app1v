import { createHash, randomBytes } from 'node:crypto';

export const API_KEY_PREFIX = 'trl_';

export function hashApiKey(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateApiKey(): {
  token: string;
  keyPrefix: string;
  keyHash: string;
  keySuffix: string;
} {
  const token = `${API_KEY_PREFIX}${randomBytes(24).toString('base64url')}`;
  return {
    token,
    keyPrefix: token.slice(0, API_KEY_PREFIX.length + 7),
    keyHash: hashApiKey(token),
    keySuffix: token.slice(-4),
  };
}
