import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.gridirongm.app',
  appName: 'Gridiron GM',
  webDir: 'dist',

  server: {
    // The live site your mobile app should load
    url: 'https://gridiron-gm.com',
    cleartext: false
  }
};

export default config;
