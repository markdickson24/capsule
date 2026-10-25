import { Linking } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { toast } from './toast';
import { reportError } from './sentry';

/**
 * Opens an external link without ever leaving an unhandled rejection.
 *
 * A bare `Linking.openURL` rejects with "Unable to open URL" when iOS has no
 * handler it will use — seen in production on the SignUp privacy link from an
 * App Review device (REACT-NATIVE-A), where an unhandled rejection reads as a
 * broken legal link. https links fall back to the in-app browser
 * (SFSafariViewController), which doesn't depend on that handler; anything
 * else (mailto:) can't, so it toasts with `fallbackText` instead.
 */
export async function openLink(url: string, fallbackText?: string): Promise<void> {
  try {
    await Linking.openURL(url);
    return;
  } catch (err) {
    if (/^https?:/i.test(url)) {
      try {
        await WebBrowser.openBrowserAsync(url);
        return;
      } catch (browserErr) {
        reportError(browserErr, { where: 'openLink.browser', extra: { url } });
      }
    } else {
      reportError(err, { where: 'openLink', extra: { url } });
    }
  }
  toast.show(fallbackText ?? `Couldn't open ${url}`);
}
