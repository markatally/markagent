import { Context, Next } from 'hono';
import { verifyToken, TokenPayload } from '../services/auth';

// Extend Hono context to include user info
export interface AuthContext {
  Variables: {
    user: TokenPayload;
  };
}

/**
 * Authentication middleware
 * Verifies JWT token from Authorization header
 * Adds user info to context
 */
export async function requireAuth(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  let token = '';

  if (authHeader) {
    // Extract token from "Bearer <token>"
    token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) {
      return c.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid authorization header format',
          },
        },
        401
      );
    }
  } else {
    token = c.req.query('token') || '';
    if (!token) {
      return c.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authorization header or token query parameter is required',
          },
        },
        401
      );
    }
  }

  try {
    // Verify token
    const payload = verifyToken(token);

    // Check token type
    if (payload.type !== 'access') {
      return c.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid token type',
          },
        },
        401
      );
    }

    // Add user to context
    c.set('user', payload);

    await next();
  } catch (error) {
    return c.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired token',
        },
      },
      401
    );
  }
}
