import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.gridirongm.app',
  appName: 'Gridiron GM',
  webDir: 'dist',

  server: {
    // Load live site so web updates reflect instantly without a new app binary
    url: 'https://gridiron-gm.com',
    cleartext: false,
    androidScheme: 'https',
  },

  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 2000,
      backgroundColor: '#1a1a2e',
      showSpinner: false,
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#1a1a2e',
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },

  ios: {
    contentInset: 'automatic',
    allowsLinkPreview: false,
    backgroundColor: '#0d0d0d',
  },

  android: {
    backgroundColor: '#1a1a2e',
  },
};

export default config;
