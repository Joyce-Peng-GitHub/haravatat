export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  url: string,
  options: { method?: string; body?: object | FormData; signal?: AbortSignal } = {},
): Promise<T> {
  const multipart = options.body instanceof FormData;
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    signal: options.signal,
    headers: {
      'X-Haravatat-Request': '1',
      ...(!multipart && options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body
      ? multipart
        ? (options.body as FormData)
        : JSON.stringify(options.body)
      : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new ApiError(response.status, result.error ?? '请求失败');
  return result as T;
}
export interface User {
  id: string;
  login: string;
  name: string;
  avatar_url: string;
}
export interface Post {
  id: string;
  title: string;
  format: 'typst' | 'markdown';
  published_at: string;
  updated_at: string;
  name: string;
  login: string;
  avatar_url: string;
  source_name: string;
  markdown?: string;
}
export interface Source {
  id: string;
  name: string;
  kind: 'upload' | 'github' | 'git';
  repository: string | null;
  branch: string | null;
  revision: number;
  commit_sha: string | null;
  target_commit: string | null;
  file_count?: number;
  post_count?: number;
}
export interface Workspace {
  source: Source;
  files: {
    path: string;
    size: number;
    post_id: string | null;
    title: string | null;
    source_revision: number | null;
  }[];
  posts: { id: string; entry_path: string; title: string; source_revision: number }[];
}
export function date(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '操作失败，请重试';
}
