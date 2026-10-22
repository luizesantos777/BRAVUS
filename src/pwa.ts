export function isAppleMobile() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}
export function isInstalledApp() {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
export function needsAppleInstallation() { return window.isSecureContext && isAppleMobile() && !isInstalledApp(); }
export function publicAssetUrl(filename: string) {
  const base = window.location.hostname.endsWith('.github.io') ? '/' + window.location.pathname.split('/').filter(Boolean)[0] + '/' : import.meta.env.BASE_URL;
  return new URL(base + filename, window.location.origin).href;
}
