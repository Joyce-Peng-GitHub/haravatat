import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import type { Config } from './config.js';
import type { Database } from './db.js';
import { authRoutes } from './auth.js';
import { githubAuth, type GitHubAuth } from './github.js';
import { HttpError } from './errors.js';
import { sourceRoutes } from './sources.js';
import { postRoutes } from './posts.js';
import { remoteCompiler, type Compiler } from './compile.js';
import { createGitRepositories, httpsDnsLookup, type RepositoryClient } from './repository.js';
export interface AppDependencies {
  db: Database;
  config: Config;
  github?: GitHubAuth;
  repositories?: RepositoryClient;
  compiler?: Compiler;
}
export async function createApp({ db, config, github, repositories, compiler }: AppDependencies) {
  const app = Fastify({
    logger: config.NODE_ENV !== 'test',
    bodyLimit: 2 * 1024 * 1024,
    requestTimeout: 300_000,
  });
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
        workerSrc: ["'self'", 'blob:'],
        imgSrc: ["'self'", 'https:', 'data:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    hsts: config.secureCookies ? undefined : false,
  });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  app.addHook('onRequest', async (request) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      if (
        request.headers.origin !== config.APP_ORIGIN ||
        request.headers['x-haravatat-request'] !== '1'
      )
        throw new HttpError(403, '请求来源无效');
    }
  });
  app.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/auth') || request.url.startsWith('/api'))
      reply.header('Cache-Control', 'no-store');
    return payload;
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError)
      return reply.status(400).send({
        error: '输入格式无效',
        details: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    const status =
      error instanceof HttpError
        ? error.statusCode
        : error &&
            typeof error === 'object' &&
            'statusCode' in error &&
            typeof error.statusCode === 'number'
          ? error.statusCode
          : 500;
    if (status >= 500) request.log.error(error);
    return reply.status(status).send({
      error:
        error instanceof HttpError
          ? error.message
          : status < 500
            ? '请求无效或文件超过限制'
            : '服务器处理失败，请稍后重试',
    });
  });
  app.get('/api/health', async () => {
    await db.query('SELECT 1');
    return { ok: true };
  });
  authRoutes(
    app,
    db,
    config,
    github ?? githubAuth(config.GITHUB_CLIENT_ID, config.GITHUB_CLIENT_SECRET, config.APP_ORIGIN),
  );
  await sourceRoutes(
    app,
    db,
    repositories ??
      createGitRepositories(
        config.GIT_DNS_OVER_HTTPS_URL ? httpsDnsLookup(config.GIT_DNS_OVER_HTTPS_URL) : undefined,
      ),
    config.CREDENTIAL_ENCRYPTION_KEY,
  );
  postRoutes(app, db, compiler ?? remoteCompiler(config.COMPILER_URL));
  return app;
}
