import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const JWT_SECRET = process.env.JWT_SECRET!;
const JWT_ACCESS_EXPIRY = '15m';
const JWT_REFRESH_EXPIRY = '7d';

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

export interface TokenPayload {
  userId: string;
  email: string;
  type: 'access' | 'refresh';
}

export interface DownloadTokenPayload {
  userId: string;
  sessionId: string;
  fileId: string;
  type: 'download';
}

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  const hash = await bcrypt.hash(password, 10);
  // Ensure the hash is always returned as a string
  return String(hash);
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  // Ensure both arguments are strings
  if (typeof password !== 'string') {
    throw new Error('Password must be a string');
  }
  if (typeof hash !== 'string' || !hash) {
    throw new Error('Hash must be a non-empty string');
  }
  return bcrypt.compare(password, hash);
}

/**
 * Generate JWT access token (15 minutes)
 */
export function generateAccessToken(userId: string, email: string): string {
  const payload: TokenPayload = {
    userId,
    email,
    type: 'access',
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_ACCESS_EXPIRY });
}

/**
 * Generate JWT refresh token (7 days)
 */
export function generateRefreshToken(userId: string, email: string): string {
  const payload: TokenPayload = {
    userId,
    email,
    type: 'refresh',
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_REFRESH_EXPIRY });
}

/**
 * Verify and decode a JWT token
 */
export function verifyToken(token: string): TokenPayload {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload;
    return decoded;
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
}

/**
 * Generate both access and refresh tokens
 */
export function generateTokenPair(userId: string, email: string) {
  return {
    accessToken: generateAccessToken(userId, email),
    refreshToken: generateRefreshToken(userId, email),
  };
}

/**
 * Generate JWT download token (60 seconds)
 * Used for temporary file download URLs
 */
export function generateDownloadToken(userId: string, sessionId: string, fileId: string): string {
  const payload: DownloadTokenPayload = {
    userId,
    sessionId,
    fileId,
    type: 'download',
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '60s' });
}

/**
 * Verify and decode a download token
 */
export function verifyDownloadToken(token: string): DownloadTokenPayload {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as DownloadTokenPayload;
    if (decoded.type !== 'download') {
      throw new Error('Invalid token type');
    }
    return decoded;
  } catch (error) {
    throw new Error('Invalid or expired download token');
  }
}
