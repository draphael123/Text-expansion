import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

// Common build options
const commonOptions = {
  bundle: true,
  minify: false,  // Keep readable for debugging
  sourcemap: false,
  target: ['chrome100'],
  format: 'iife',
  logLevel: 'info',
};

// Build configurations for each entry point
const builds = [
  {
    ...commonOptions,
    entryPoints: ['src/dashboard/index.js'],
    outfile: 'dist/dashboard.js',
  },
  {
    ...commonOptions,
    entryPoints: ['src/content/index.js'],
    outfile: 'dist/content.js',
  },
  {
    ...commonOptions,
    entryPoints: ['src/background/index.js'],
    outfile: 'dist/background.js',
  },
  {
    ...commonOptions,
    entryPoints: ['src/popup/index.js'],
    outfile: 'dist/popup.js',
  },
];

async function build() {
  try {
    if (isWatch) {
      // Create contexts for watch mode
      const contexts = await Promise.all(
        builds.map(config => esbuild.context(config))
      );

      // Start watching all contexts
      await Promise.all(contexts.map(ctx => ctx.watch()));

      console.log('Watching for changes...');
    } else {
      // One-time build
      await Promise.all(builds.map(config => esbuild.build(config)));
      console.log('Build complete!');
    }
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
