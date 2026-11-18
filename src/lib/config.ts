/**
 * Server addresses. Override for staging or local development with
 * EXPO_PUBLIC_WEB_URL / EXPO_PUBLIC_WSS_URL (read at build time).
 */
const trim = (u: string) => u.replace(/\/+$/, '');

export const WEB_URL = trim(process.env.EXPO_PUBLIC_WEB_URL || 'https://www.funprinting.store');
export const WSS_URL = trim(process.env.EXPO_PUBLIC_WSS_URL || 'https://funprinting-wss.onrender.com');
export const RELEASES_URL = 'https://api.github.com/repos/FunPrinting/partner-mobile/releases/latest';
