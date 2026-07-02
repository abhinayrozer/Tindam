'use strict';

// Authentication primitives: scrypt password hashing, opaque session tokens,
// password-reset tokens, and Google ID-token verification (when configured).

const crypto = require('crypto');
const https = require('https');

const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;   // 7 days
const RESET_TTL_MS = 30 * 60 * 1000;           // 30 minutes

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}

function newToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function validPassword(pw) {
  return typeof pw === 'string' && pw.length >= 8 && pw.length <= 100;
}

function validUsername(u) {
  return typeof u === 'string' && /^[a-z0-9._-]{3,30}$/i.test(u);
}

function validEmail(e) {
  return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 120;
}

// ---- Google Sign-In (ID token) verification ----
// Requires GOOGLE_CLIENT_ID in the environment. Verifies signature against
// Google's published JWKS, plus audience/issuer/expiry.

let jwksCache = { keys: null, fetchedAt: 0 };

function fetchGoogleJwks() {
  return new Promise((resolve, reject) => {
    if (jwksCache.keys && Date.now() - jwksCache.fetchedAt < 6 * 3600 * 1000) {
      return resolve(jwksCache.keys);
    }
    const req = https.get('https://www.googleapis.com/oauth2/v3/certs', { timeout: 6000 }, (res) => {
      let raw = '';
      res.on('data', (c) => raw += c);
      res.on('end', () => {
        try {
          const keys = JSON.parse(raw).keys;
          jwksCache = { keys, fetchedAt: Date.now() };
          resolve(keys);
        } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Google JWKS fetch timed out')));
    req.on('error', reject);
  });
}

async function verifyGoogleIdToken(credential, clientId) {
  const parts = String(credential).split('.');
  if (parts.length !== 3) throw new Error('Malformed Google credential');
  const b64 = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const header = JSON.parse(b64(parts[0]).toString());
  const payload = JSON.parse(b64(parts[1]).toString());

  if (payload.aud !== clientId) throw new Error('Google token audience mismatch');
  if (!['https://accounts.google.com', 'accounts.google.com'].includes(payload.iss)) {
    throw new Error('Google token issuer mismatch');
  }
  if (payload.exp * 1000 < Date.now()) throw new Error('Google token expired');
  if (!payload.email || !payload.email_verified) throw new Error('Google account email not verified');

  const keys = await fetchGoogleJwks();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('Google signing key not found');
  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const ok = crypto.verify(
    'RSA-SHA256',
    Buffer.from(parts[0] + '.' + parts[1]),
    publicKey,
    b64(parts[2])
  );
  if (!ok) throw new Error('Google token signature invalid');
  return { email: payload.email, name: payload.name || payload.email.split('@')[0], sub: payload.sub };
}

module.exports = {
  SESSION_TTL_MS, RESET_TTL_MS,
  hashPassword, verifyPassword, newToken,
  validPassword, validUsername, validEmail,
  verifyGoogleIdToken
};
