# FunPrinting Partner (mobile)

Expo SDK 57 app for print shops (Android and iOS), built with Expo Router.

```
npm install
npm start                 # Expo dev server (sign-in needs a development build or a release build)
npm test                  # unit tests (IPP encoding, job decisions) with node --test
npm run typecheck && npm run lint
EXPO_PUBLIC_WEB_URL=http://192.168.1.5:3000 EXPO_PUBLIC_WSS_URL=http://192.168.1.5:8080 npm start   # local servers
```

Release APKs are built by `.github/workflows/build-mobile.yml` on pushes to `main`.

## What the app does

| Tab | Purpose |
|---|---|
| **Jobs** | The shop's live print jobs: orders to accept or decline (manual-acceptance shops), the job printing on this phone, jobs waiting, jobs on other devices. The tab shows a badge with the number of orders to accept. |
| **Orders** | All orders (Open / Done / All). Tap an order to move it on: printed, ready for pickup, delivered, completed. |
| **Shop** | Earnings, taking orders on/off, "accept each order first", prices, phone numbers, map location, delivery points. |
| **Settings** | Companion or print station, printer setup and test page, pause/resume the desktop app, signed-in devices, updates (Android), sign out. |

### Companion (default)
Sees and manages orders; the shop's desktop app prints them.

### Print station
The phone takes one job at a time from the shop's queue and prints it while the app is open (the screen stays on). It shares the queue with the shop's other devices.

| Printer | Platform | How |
|---|---|---|
| Wi-Fi printer (IPP) | Android | The file goes straight to the printer (`ipp://<address>:631/ipp/print`) with copies, sides, colour and paper size; the app waits until the printer reports the job completed. "Connect" reads the printer's capabilities first. |
| AirPrint printer | iOS | Chosen once; later jobs print without a dialog. iOS applies the printer's own colour and double-sided settings. |
| System print dialog | both | Each file opens the print dialog; the shop confirms it printed. |

Jobs this phone can't print stay in the queue for the desktop app, with the reason shown: Word files, or options the printer lacks (double-sided, colour, A3). Mixed-colour files print in colour.

## Design

Follows the platform guidelines current for iOS 26 and Android 16:
- **System navigation:** native tab bar (`expo-router/unstable-native-tabs`): Liquid Glass on iOS 26, Material navigation bar on Android, minimises on scroll. Large titles in native stack headers.
- **Icons:** SF Symbols on iOS and Material Symbols on Android (`expo-symbols`).
- **Colour:** neutral system surfaces; brand indigo only on content. Light and dark mode follow the system. Text contrast 4.5:1 or more.
- **Type:** iOS text-style sizes (Body 17, Large Title 34); scales with the system font size.
- **Accessibility:** touch targets at least 48 dp / 44 pt; every control has a role and label.
- **Feedback:** haptics on buttons and switches; pull to refresh; empty states and banners that say what to do next.

## How it works

- **Sign-in:** browser sign-in at `/partner/desktop-auth` with PKCE (`expo-web-browser` auth session, `funprintingpartner://callback`). The app receives a one-time code and exchanges it for a 15-minute access token and a 30-day refresh token. Tokens are kept in SecureStore and are not restored to a new phone. Server side: FunPrinting-Web `docs/PARTNER_AUTH.md`.
- **Jobs:** `/api/partner/v1/jobs`, refreshed on connect, on `jobs:available` from the socket, when the app returns to the foreground and every minute. Server side: `docs/PRINT_JOBS.md`.
- **Errors** go to the web app's error log (`/api/errors`, shown in `/admin/errors`).

## Limits

- The print station prints only while the app is open in the foreground. Expo has no foreground-service module, so Android may pause the app in the background; jobs then wait in the queue (or go to the desktop app) and nothing is lost.
- Android sends files to Wi-Fi printers over plain HTTP on the local network (IPP), so the app allows cleartext traffic. All FunPrinting API calls use HTTPS.
- There are no push notifications yet; new orders show when the app is open.

## Layout

| Path | Purpose |
|---|---|
| `src/app/` | Routes: `_layout.tsx` (sign-in guard), `sign-in.tsx`, `(tabs)/` with a stack per tab |
| `src/components/` | UI building blocks (`ui.tsx`), `JobCard`, `TabStack` |
| `src/theme.ts` | Colours, spacing, type scale |
| `src/lib/session.ts` | Sign-in, tokens, API calls |
| `src/lib/jobs.ts`, `connection.ts`, `services.ts` | Job list, socket, start/stop on sign-in and app state |
| `src/lib/printStation.ts`, `printers.ts`, `ipp.ts` | Print station, printing methods, IPP encoding |
| `src/lib/jobLogic.ts` | Pure decisions (which job to print, order status moves) |
| `test/` | Node unit tests for the pure modules |
