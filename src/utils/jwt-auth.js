import jwt from 'jsonwebtoken';
import { NextResponse } from 'next/server';

const JWT_SECRET = process.env.JWT_SECRET || 'your-default-secret-key';

/**
 * Generate a JWT token for a user
 * @param {Object} payload - The payload to include in the token
 * @param {string} expiresIn - Token expiration time (default: 8h)
 * @returns {string} JWT token
 */
export function generateToken(payload, expiresIn = '8h') {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn,
    issuer: 'accent-crm'
  });
}

/**
 * Verify and decode a JWT token
 * @param {string} token - The JWT token to verify
 * @returns {Object|null} Decoded payload or null if invalid
 */
export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    console.error('JWT verification failed:', error);
    return null;
  }
}

/**
 * Extract JWT token from request cookies
 * @param {Request} request - The request object
 * @returns {string|null} JWT token or null if not found
 */
export function extractTokenFromRequest(request) {
  return request?.cookies?.get?.('auth_token')?.value || null;
}

/**
 * Middleware to authenticate JWT token from request
 * @param {Request} request - The request object
 * @returns {Object} { authenticated: boolean, user: Object|null, error: string|null }
 */
export function authenticateJWT(request) {
  const token = extractTokenFromRequest(request);
  
  if (!token) {
    return {
      authenticated: false,
      user: null,
      error: 'No authentication token provided'
    };
  }

  const decoded = verifyToken(token);
  
  if (!decoded) {
    return {
      authenticated: false,
      user: null,
      error: 'Invalid or expired token'
    };
  }

  return {
    authenticated: true,
    user: decoded,
    error: null
  };
}

/**
 * Middleware function that returns 401 if not authenticated
 * @param {Request} request - The request object
 * @returns {Object|NextResponse} { user } if authenticated, or NextResponse with 401
 */
export function requireAuth(request) {
  const auth = authenticateJWT(request);
  
  if (!auth.authenticated) {
    return NextResponse.json(
      { success: false, message: auth.error },
      { status: 401 }
    );
  }
  
  return { user: auth.user };
}

/**
 * Set JWT token in response cookies
 * @param {NextResponse} response - The response object
 * @param {string} token - The JWT token
 */
export function setTokenCookie(response, token) {
  const isProd = process.env.NODE_ENV === 'production';
  
  response.cookies.set('auth_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
    maxAge: 60 * 60 * 8 // 8 hours
  });
}

/**
 * Clear JWT token from response cookies
 * @param {NextResponse} response - The response object
 */
export function clearTokenCookie(response) {
  const isProd = process.env.NODE_ENV === 'production';
  
  response.cookies.set('auth_token', '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
    maxAge: 0
  });
}