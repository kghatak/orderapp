import { createHash, randomBytes } from 'crypto';

export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function createToken() {
  return randomBytes(32).toString('hex');
}
