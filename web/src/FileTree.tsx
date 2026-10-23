import { useMemo, useState, type ReactNode } from 'react';
import type { Workspace } from './api';

type File = Workspace['files'][number];
interface Directory {
  path: string;
  name: string;
  directories: Map<string, Directory>;
  files: File[];
}

export function FileTree({
  files,
  filter,
  directories: storedDirectories,
  renderDirectoryActions,
  renderFile,
}: {
  files: File[];
  filter: string;
  directories: string[];
  renderDirectoryActions?: (path: string) => ReactNode;
  renderFile: (file: File, depth: number) => ReactNode;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { root, directories } = useMemo(() => {
    const root: Directory = { path: '', name: '', directories: new Map(), files: [] };
    const directories: string[] = [];
    const addDirectory = (path: string) => {
      let parent = root;
      for (const name of path.split('/').filter(Boolean)) {
        const fullPath = [parent.path, name].filter(Boolean).join('/');
        if (!parent.directories.has(name)) {
          parent.directories.set(name, { path: fullPath, name, directories: new Map(), files: [] });
          directories.push(fullPath);
        }
        parent = parent.directories.get(name)!;
      }
      return parent;
    };
    for (const path of storedDirectories) {
      if (path.toLowerCase().includes(filter.toLowerCase())) addDirectory(path);
    }
    for (const file of files) {
      if (!file.path.toLowerCase().includes(filter.toLowerCase())) continue;
      addDirectory(file.path.split('/').slice(0, -1).join('/')).files.push(file);
    }
    return { root, directories };
  }, [files, filter, storedDirectories]);
  const children = (parent: Directory, depth: number): ReactNode => (
    <ul className="file-tree" aria-label={parent.path ? `目录 ${parent.path}` : '文件树'}>
      {[...parent.directories.values()]
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
        .map((directory) => {
          const open = Boolean(filter) || !collapsed.has(directory.path);
          return (
            <li key={directory.path}>
              <div
                className="directory-row"
                data-directory={directory.path}
                style={{ paddingInlineStart: 17 + Math.min(depth, 6) * 14 }}
              >
                <button
                  className="directory-toggle"
                  aria-label={`目录 ${directory.path}`}
                  aria-expanded={open}
                  onClick={() =>
                    setCollapsed((old) => {
                      const next = new Set(old);
                      if (open) next.add(directory.path);
                      else next.delete(directory.path);
                      return next;
                    })
                  }
                  disabled={Boolean(filter)}
                >
                  <span aria-hidden="true">{open ? '▾' : '▸'} ▱</span>
                  <span title={directory.path}>{directory.name}</span>
                </button>
                {renderDirectoryActions && (
                  <div className="file-actions">{renderDirectoryActions(directory.path)}</div>
                )}
              </div>
              {open && children(directory, depth + 1)}
            </li>
          );
        })}
      {[...parent.files]
        .sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'))
        .map((file) => (
          <li key={file.path}>{renderFile(file, depth)}</li>
        ))}
    </ul>
  );
  return (
    <>
      <div className="tree-tools">
        <span>文件树 · {files.length} 个文件</span>
        <div className="tool-actions">
          <button disabled={Boolean(filter)} onClick={() => setCollapsed(new Set())}>
            展开全部
          </button>
          <button disabled={Boolean(filter)} onClick={() => setCollapsed(new Set(directories))}>
            收起全部
          </button>
        </div>
      </div>
      {!root.files.length && !root.directories.size ? (
        <p className="empty">没有匹配的文件或文件夹。</p>
      ) : (
        children(root, 0)
      )}
    </>
  );
}
