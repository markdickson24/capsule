// TypeScript-resolution fallback for the platform-split RevenueCat module.
// Metro bundles purchases.native.ts / purchases.web.ts per platform; TS resolves
// bare `../lib/purchases` imports here. Re-export the web stub — its signatures
// match the native module — so types are correct everywhere. Same pattern as
// usePushNotifications.ts.
export * from './purchases.web';
