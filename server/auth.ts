import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from './config.js';
import type { Database } from './db.js';
import type { GitHubAuth } from './github.js';
import { HttpError } from './errors.js';
export interface User {
  id: string;
  login: string;
  name: string;
  avatar_url: string;
}
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
export async function currentUser(db: Database, request: FastifyRequest): Promise<User | null> {
  const session = request.cookies.session;
  if (!session) return null;
  const { rows } = await db.query<User>(
    'SELECT u.id::text, u.login, u.name, u.avatar_url FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()',
    [hash(session)],
  );
  return rows[0] ?? null;
}
export async function requireUser(db: Database, request: FastifyRequest) {
  const user = await currentUser(db, request);
  if (!user) throw new HttpError(401, '请先通过 GitHub 登录');
  return user;
}
export function authRoutes(app: FastifyInstance, db: Database, config: Config, github: GitHubAuth) {
  const cookieOptions = {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.secureCookies,
  };
  app.get('/api/me', async (request) => ({
    user: await currentUser(db, request),
    loginConfigured: Boolean(config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET),
  }));
  app.get(
    '/auth/github',
    { config: { rateLimit: { max: 15, timeWindow: '1 minute' } } },
    async (_, reply) => {
      if (!config.GITHUB_CLIENT_ID || !config.GITHUB_CLIENT_SECRET)
        throw new HttpError(503, '管理员尚未配置 GitHub 登录');
      const state = token(),
        verifier = token();
      await db.query('DELETE FROM oauth_states WHERE expires_at<now()');
      await db.query("INSERT INTO oauth_states VALUES ($1, $2, now()+interval '10 minutes')", [
        hash(state),
        verifier,
      ]);
      reply.setCookie('oauth_state', state, { ...cookieOptions, maxAge: 600 });
      const params = new URLSearchParams({
        client_id: config.GITHUB_CLIENT_ID,
        redirect_uri: `${config.APP_ORIGIN}/auth/github/callback`,
        state,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256',
      });
      return reply.redirect(`https://github.com/login/oauth/authorize?${params}`);
    },
  );
  app.get('/auth/github/callback', async (request, reply) => {
    const query = z
      .object({ code: z.string().min(1).max(300), state: z.string().min(1).max(100) })
      .safeParse(request.query);
    const cookie = request.cookies.oauth_state;
    reply.clearCookie('oauth_state', cookieOptions);
    if (
      !query.success ||
      !cookie ||
      !timingSafeEqual(Buffer.from(hash(cookie)), Buffer.from(hash(query.data.state)))
    )
      throw new HttpError(400, '登录状态无效或过期，请重新登录');
    const state = await db.query<{ verifier: string }>(
      'DELETE FROM oauth_states WHERE token_hash=$1 AND expires_at>now() RETURNING verifier',
      [hash(cookie)],
    );
    if (!state.rows[0]) throw new HttpError(400, '登录状态已过期或使用');
    const identity = await github.exchange(query.data.code, state.rows[0].verifier);
    const session = token();
    await db.transaction(async (tx) => {
      await tx.query(
        'INSERT INTO users (id, login, name, avatar_url) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET login=excluded.login, name=excluded.name, avatar_url=excluded.avatar_url',
        [identity.id, identity.login, identity.name || identity.login, identity.avatar_url],
      );
      await tx.query('DELETE FROM sessions WHERE expires_at<now()');
      if (request.cookies.session)
        await tx.query('DELETE FROM sessions WHERE token_hash=$1', [hash(request.cookies.session)]);
      await tx.query("INSERT INTO sessions VALUES ($1,$2,now()+interval '30 days')", [
        hash(session),
        identity.id,
      ]);
    });
    reply.setCookie('session', session, { ...cookieOptions, maxAge: 30 * 24 * 3600 });
    return reply.redirect(`${config.APP_ORIGIN}/dashboard`);
  });
  app.post('/auth/logout', async (request, reply) => {
    if (request.cookies.session)
      await db.query('DELETE FROM sessions WHERE token_hash=$1', [hash(request.cookies.session)]);
    reply.clearCookie('session', cookieOptions);
    return { ok: true };
  });
}
