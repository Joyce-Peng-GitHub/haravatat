import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cp } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, extname } from 'node:path';
const pdfRoot = resolve('node_modules/pdfjs-dist');
const folders = ['cmaps', 'standard_fonts', 'wasm'];
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'pdf-reader-assets',
      configureServer(server) {
        server.middlewares.use('/pdf-assets', (request, response, next) => {
          const path = decodeURIComponent((request.url || '').split('?')[0]);
          if (!/^\/(cmaps|standard_fonts|wasm)\/[A-Za-z0-9_.-]+$/.test(path)) return next();
          const stream = createReadStream(resolve(pdfRoot, `.${path}`));
          response.setHeader(
            'Content-Type',
            extname(path) === '.wasm'
              ? 'application/wasm'
              : extname(path) === '.js'
                ? 'text/javascript'
                : 'application/octet-stream',
          );
          stream.on('error', () => {
            response.statusCode = 404;
            response.end();
          });
          stream.pipe(response);
        });
      },
      async closeBundle() {
        await Promise.all(
          folders.map((folder) =>
            cp(resolve(pdfRoot, folder), resolve('dist/pdf-assets', folder), { recursive: true }),
          ),
        );
      },
    },
  ],
  root: 'web',
  build: { outDir: '../dist', emptyOutDir: true },
  server: { proxy: { '/api': 'http://127.0.0.1:3000', '/auth': 'http://127.0.0.1:3000' } },
});
