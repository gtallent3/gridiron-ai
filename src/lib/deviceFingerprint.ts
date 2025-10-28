/**
 * Generate a device fingerprint for multi-account detection
 */
export async function generateDeviceFingerprint(): Promise<string> {
  const components: string[] = [];

  // Screen resolution
  components.push(`${window.screen.width}x${window.screen.height}x${window.screen.colorDepth}`);

  // Timezone
  components.push(Intl.DateTimeFormat().resolvedOptions().timeZone);

  // Language
  components.push(navigator.language);

  // Platform
  components.push(navigator.platform);

  // User agent
  components.push(navigator.userAgent);

  // Hardware concurrency
  components.push(navigator.hardwareConcurrency?.toString() || 'unknown');

  // Device memory (if available)
  const deviceMemory = (navigator as any).deviceMemory;
  components.push(deviceMemory?.toString() || 'unknown');

  // Canvas fingerprint
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (ctx) {
      canvas.width = 200;
      canvas.height = 50;
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillStyle = '#f60';
      ctx.fillRect(0, 0, 100, 50);
      ctx.fillStyle = '#069';
      ctx.fillText('GridIron GM', 2, 2);
      components.push(canvas.toDataURL());
    }
  } catch (e) {
    components.push('canvas-error');
  }

  // WebGL fingerprint
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (gl && 'getParameter' in gl) {
      const glParams = [
        (gl as WebGLRenderingContext).getParameter((gl as WebGLRenderingContext).VENDOR),
        (gl as WebGLRenderingContext).getParameter((gl as WebGLRenderingContext).RENDERER),
      ];
      components.push(glParams.join('~'));
    }
  } catch (e) {
    components.push('webgl-error');
  }

  // Touch support
  components.push(('ontouchstart' in window).toString());

  // Session storage available
  components.push(typeof sessionStorage !== 'undefined' ? 'true' : 'false');

  // Local storage available
  components.push(typeof localStorage !== 'undefined' ? 'true' : 'false');

  // Combine all components and hash
  const fingerprint = components.join('|');
  
  // Simple hash function (for production, consider using a proper hash library)
  return await simpleHash(fingerprint);
}

async function simpleHash(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Get client IP address (best effort - relies on headers if behind proxy)
 */
export function getClientIP(): string {
  // In production, this should be set server-side from request headers
  // For now, return a placeholder that edge functions can override
  return 'client-side';
}
