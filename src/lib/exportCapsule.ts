// TS-resolution fallback. React Native's Metro bundler picks .native.ts /
// .web.ts by platform; this bare .ts is what the TypeScript compiler and any
// non-platform import resolve to. Re-export the web stub (safe everywhere).
export * from './exportCapsule.web';
