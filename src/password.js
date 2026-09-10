import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verificaPassword(password, salvato) {
  const parti = String(salvato || '').split(':');
  if (parti.length !== 3 || parti[0] !== 'scrypt') return false;
  const [, salt, atteso] = parti;
  const prova = scryptSync(String(password), salt, 64).toString('hex');
  const a = Buffer.from(atteso, 'hex');
  const b = Buffer.from(prova, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
