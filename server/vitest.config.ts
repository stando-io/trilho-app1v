import { defineConfig } from 'vitest/config';

const resolveJsToTs = {
  name: 'resolve-js-to-ts',
  enforce: 'pre' as const,
  async resolveId(source: string, importer: string | undefined) {
    if (source.startsWith('.') && source.endsWith('.js') && importer) {
      const candidate = source.replace(/\.js$/, '.ts');
      const resolved = await this.resolve(candidate, importer, { skipSelf: true });
      if (resolved) return resolved;
    }
    return null;
  },
};

export default defineConfig({
  plugins: [resolveJsToTs],
  test: {
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
