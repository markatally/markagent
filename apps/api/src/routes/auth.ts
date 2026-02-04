import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { prisma } from '../services/prisma';
import {
  hashPassword,
  verifyPassword,
  generateTokenPair,
  verifyToken,
} from '../services/auth';
import {
  generateState,
  getGoogleAuthorizationUrl,
  getGoogleRedirectUri,
  exchangeGoogleCode,
  completeGoogleLogin,
} from '../services/oauth';

const auth = new Hono();

// Validation schemas
const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

/**
 * POST /api/auth/register
 * Register a new user
 */
auth.post('/register', zValidator('json', registerSchema), async (c) => {
  const { email, password } = c.req.valid('json');

  // Check if user already exists
  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    return c.json(
      {
        error: {
          code: 'USER_EXISTS',
          message: 'User with this email already exists',
        },
      },
      409
    );
  }

  // Hash password
  const passwordHash = await hashPassword(password);

  // Ensure passwordHash is a string
  if (typeof passwordHash !== 'string') {
    console.error('Password hash is not a string:', typeof passwordHash, passwordHash);
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to hash password',
        },
      },
      500
    );
  }

  // Create user
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
    },
    select: {
      id: true,
      email: true,
      createdAt: true,
    },
  });

  // Generate tokens
  const tokens = generateTokenPair(user.id, user.email);

  return c.json(
    {
      user,
      ...tokens,
    },
    201
  );
});

/**
 * POST /api/auth/login
 * Login with email and password
 */
auth.post('/login', zValidator('json', loginSchema), async (c) => {
  const { email, password } = c.req.valid('json');

  // Find user
  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    return c.json(
      {
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password',
        },
      },
      401
    );
  }

  // Check if user has a password hash (not OAuth-only user)
  if (!user.passwordHash) {
    return c.json(
      {
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'This account uses Google login. Please sign in with Google.',
        },
      },
      401
    );
  }

  // Ensure passwordHash is a string
  const passwordHash = typeof user.passwordHash === 'string' 
    ? user.passwordHash 
    : String(user.passwordHash);

  // Verify password
  const isValid = await verifyPassword(password, passwordHash);

  if (!isValid) {
    return c.json(
      {
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password',
        },
      },
      401
    );
  }

  // Generate tokens
  const tokens = generateTokenPair(user.id, user.email);

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      createdAt: user.createdAt,
    },
    ...tokens,
  });
});

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 */
auth.post('/refresh', zValidator('json', refreshSchema), async (c) => {
  const { refreshToken } = c.req.valid('json');

  try {
    // Verify refresh token
    const payload = verifyToken(refreshToken);

    if (payload.type !== 'refresh') {
      return c.json(
        {
          error: {
            code: 'INVALID_TOKEN',
            message: 'Invalid token type',
          },
        },
        401
      );
    }

    // Verify user still exists
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
    });

    if (!user) {
      return c.json(
        {
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found',
          },
        },
        401
      );
    }

    // Generate new tokens
    const tokens = generateTokenPair(user.id, user.email);

    return c.json(tokens);
  } catch (error) {
    return c.json(
      {
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid or expired refresh token',
        },
      },
      401
    );
  }
});

/**
 * GET /api/auth/google/redirect-uri
 * Return the redirect URI this app sends to Google. Copy this EXACT value into
 * Google Cloud Console → Credentials → OAuth 2.0 Client → Authorized redirect URIs.
 */
auth.get('/google/redirect-uri', (c) => {
  const uri = getGoogleRedirectUri();
  if (!uri) {
    return c.json(
      { error: { code: 'OAUTH_NOT_CONFIGURED', message: 'Google OAuth is not configured' } },
      503
    );
  }
  return c.json({
    redirectUri: uri,
    hint: 'Add this EXACT value in Google Cloud Console → APIs & Services → Credentials → Your OAuth 2.0 Client ID → Authorized redirect URIs (not JavaScript origins)',
  });
});

/**
 * GET /api/auth/google/authorize
 * Start Google OAuth flow - redirects to Google's authorization page
 */
auth.get('/google/authorize', async (c) => {
  const result = getGoogleAuthorizationUrl();

  if (!result) {
    return c.json(
      {
        error: {
          code: 'OAUTH_NOT_CONFIGURED',
          message: 'Google OAuth is not configured',
        },
      },
      500
    );
  }

  // Store state in cookie for callback validation
  c.header('Set-Cookie', `oauth_state=${result.state}; Path=/; HttpOnly; SameSite=Lax`);

  // Return HTTP 302 redirect to Google's OAuth page
  return c.redirect(result.url);
});

/**
 * GET /api/auth/google/callback
 * Handle Google OAuth callback - redirects to frontend after successful authentication
 * Query params: code, state
 */
auth.get('/google/callback', async (c) => {
  const { code, state } = c.req.query();

  if (!code) {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'Authorization code is required',
        },
      },
      400
    );
  }

  if (!state) {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'State parameter is required',
        },
      },
      400
    );
  }

  try {
    // Exchange code for user info
    const googleUser = await exchangeGoogleCode(code, state);

    // Complete login and get tokens
    const result = await completeGoogleLogin(googleUser);

    // Redirect to frontend with tokens as URL hash fragment (more secure than query params)
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const tokenData = encodeURIComponent(JSON.stringify(result));
    return c.redirect(`${frontendUrl}/auth/success#${tokenData}`);
  } catch (error) {
    console.error('Google OAuth error:', error);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const errorMessage = encodeURIComponent(error instanceof Error ? error.message : 'OAuth authentication failed');
    return c.redirect(`${frontendUrl}/auth/error?message=${errorMessage}`);
  }
});

const callbackSchema = z.object({
  code: z.string().min(1, 'Authorization code is required'),
  state: z.string().min(1, 'State is required'),
});

/**
 * POST /api/auth/google/callback
 * Handle Google OAuth callback
 * Body: { code: string, state: string }
 */
auth.post('/google/callback', zValidator('json', callbackSchema), async (c) => {
  const { code, state } = c.req.valid('json');

  if (!state) {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'State parameter is required',
        },
      },
      400
    );
  }

  try {
    // Exchange code for user info
    const googleUser = await exchangeGoogleCode(code, state);

    // Complete login and get tokens
    const result = await completeGoogleLogin(googleUser);

    return c.json(result);
  } catch (error) {
    console.error('Google OAuth error:', error);
    return c.json(
      {
        error: {
          code: 'OAUTH_ERROR',
          message: error instanceof Error ? error.message : 'OAuth authentication failed',
        },
      },
      401
    );
  }
});

export { auth as authRoutes };
