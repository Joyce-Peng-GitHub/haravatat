import type { FastifyRequest } from 'fastify';
import {
  MAX_FILES,
  MAX_SOURCE_BYTES,
  validateFiles,
  virtualPath,
  type SourceFile,
} from './files.js';
import { HttpError } from './errors.js';

// A file can consume the entire workspace budget; there is no separate file quota.
export const uploadLimits = {
  fileSize: MAX_SOURCE_BYTES,
  files: MAX_FILES,
  fields: 0,
  parts: MAX_FILES,
};

export async function readUpload(request: FastifyRequest): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  let bytes = 0;
  let pathError: HttpError | undefined;
  try {
    for await (const part of request.files({ throwFileSizeLimit: false })) {
      let path = '';
      try {
        path = virtualPath(decodeURIComponent(part.filename));
      } catch (error) {
        pathError ||= error instanceof HttpError ? error : new HttpError(400, '文件路径编码无效');
      }
      const chunks: Buffer[] = [];
      for await (const chunk of part.file) {
        bytes += chunk.length;
        if (bytes > MAX_SOURCE_BYTES) throw new HttpError(413, '工作区总大小不能超过 1 GiB');
        // Consume bounded input before returning a path error: replying while
        // the browser still sends a large body can mask the JSON error as a reset.
        if (!pathError) chunks.push(chunk);
      }
      if (part.file.truncated) throw new HttpError(413, '工作区总大小不能超过 1 GiB');
      if (!pathError) files.push({ path, content: Buffer.concat(chunks) });
    }
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      ['FST_FILES_LIMIT', 'FST_PARTS_LIMIT'].includes(String(error.code))
    )
      throw new HttpError(413, '每个工作区最多 1024 个文件');
    throw error;
  }
  if (pathError) throw pathError;
  validateFiles(files);
  return files;
}
