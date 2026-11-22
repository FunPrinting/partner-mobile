import { Redirect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { sessionStore } from '@/lib/session';
import { useStore } from '@/lib/store';

/**
 * OAuth callback route: funprintingpartner://callback?code=...&state=...
 *
 * During sign-in, expo-web-browser's openAuthSessionAsync() receives this link and hands the
 * result to signIn(). This screen is only rendered when the link opens the app on its own
 * (an old link, or the app was restarted mid sign-in): it finishes any pending auth session
 * and moves straight on, so it can never leave the user on a blank or spinning screen.
 */
WebBrowser.maybeCompleteAuthSession();

export default function CallbackScreen() {
  const { status } = useStore(sessionStore);
  return <Redirect href={status === 'signed-in' ? '/' : '/sign-in'} />;
}
