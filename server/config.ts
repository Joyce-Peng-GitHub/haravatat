import { z } from 'zod';
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  APP_ORIGIN: z.url().default('http://localhost:5173'),
  GITHUB_CLIENT_ID: z.string().default(''),
  GITHUB_CLIENT_SECRET: z.string().default(''),
  COMPILER_URL: z.url().default('http://127.0.0.1:3001'),
});
export type Config = ReturnType<typeof loadConfig>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.parse(env);
  const origin = new URL(parsed.APP_ORIGIN);
  if (origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password)
    throw new Error('APP_ORIGIN must be an origin without a path or credentials');
  if (parsed.NODE_ENV === 'production' && origin.protocol !== 'https:')
    throw new Error('Production APP_ORIGIN requires HTTPS');
  return { ...parsed, APP_ORIGIN: origin.origin, secureCookies: origin.protocol === 'https:' };
}
