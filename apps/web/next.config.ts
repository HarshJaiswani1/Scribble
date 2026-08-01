import type { NextConfig } from 'next'

const config: NextConfig = {
  // `shared` ships raw TS on purpose — no build step to keep in sync during
  // development. Next compiles it as part of the app graph.
  transpilePackages: ['@scribble/shared'],
  // Lets phones on the LAN load HMR/dev assets when testing via the LAN IP.
  allowedDevOrigins: ['192.168.29.212'],
}

export default config
