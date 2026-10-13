import { HttpError } from './errors.js';
export interface GitHubIdentity {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
}
export interface GitHubAuth {
  exchange(code: string, verifier: string): Promise<GitHubIdentity>;
}
export function githubAuth(clientId: string, clientSecret: string, origin: string): GitHubAuth {
  return {
    async exchange(code, verifier) {
      const response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          code_verifier: verifier,
          redirect_uri: `${origin}/auth/github/callback`,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const token = (await response.json()) as { access_token?: string };
      if (!response.ok || !token.access_token)
        throw new HttpError(502, 'GitHub 登录授权失败，请重试');
      const user = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'haravatat',
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!user.ok) throw new HttpError(502, '无法取得 GitHub 用户信息');
      const identity = (await user.json()) as GitHubIdentity;
      if (!Number.isSafeInteger(identity.id) || !identity.login || !identity.avatar_url)
        throw new HttpError(502, 'GitHub 返回了无效用户信息');
      return identity;
    },
  };
}
