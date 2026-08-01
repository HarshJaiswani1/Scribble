import type { NextConfig } from 'next'

const config: NextConfig = {
  // `shared` ships raw TS on purpose — no build step to keep in sync during
  // development. Next compiles it as part of the app graph.
  transpilePackages: ['@scribble/shared'],
}

export default config
