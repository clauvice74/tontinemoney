import type { NextConfig } from 'next';

const apiUrl = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  // La caméra est nécessaire au selfie KYC (même origine uniquement).
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // @tontine/ui est consommé en source TypeScript.
  transpilePackages: ['@tontine/ui'],
  /**
   * Même origine pour l'API : le cookie HttpOnly `tm_rt` (SameSite=Strict, Path=/api/v1/auth)
   * est ainsi envoyé par le navigateur lors du rafraîchissement de session.
   */
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
