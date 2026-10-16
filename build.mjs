import { build } from 'esbuild';
await Promise.all([
  build({ entryPoints: ['src/extension.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], outfile: 'dist/extension.js', sourcemap: true }),
  build({ entryPoints: ['src/renderer.ts'], bundle: true, platform: 'browser', format: 'esm', outfile: 'dist/renderer.js', sourcemap: true }),
  build({ entryPoints: ['src/sidebar.ts'], bundle: true, platform: 'browser', format: 'iife', outfile: 'dist/sidebar.js' }),
  build({ entryPoints: ['test/host.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], outfile: 'dist/test/host.js' }),
]);
