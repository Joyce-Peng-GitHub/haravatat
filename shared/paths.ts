export function validWorkspacePath(path: string): boolean {
  return (
    Boolean(path) &&
    path.length <= 500 &&
    !path.startsWith('/') &&
    !/[\\\x00-\x1f\x7f:]/.test(path) &&
    !path.split('/').some((part) => !part || part === '.' || part === '..' || part === '.git')
  );
}
