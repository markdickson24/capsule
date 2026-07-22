// Pure step-list builder for the new-user coach-mark tour. No React/RN imports —
// unit-testable. Two branches: a full walkthrough when the user has a capsule,
// and a shorter join-first path when they don't. Copy is warm + concrete.

export type TourScreen = 'Home' | 'CapsuleDetail';

export type TourStep = {
  id: string;
  targetId: string | null; // registry id to spotlight; null = centered finish card
  screen: TourScreen;
  params?: Record<string, unknown>;
  title: string;
  body: string;
};

const FINISH_WITH_CAP: TourStep = {
  id: 'finish', targetId: null, screen: 'Home',
  title: "You're all set 🎉", body: "That's the tour. Go make some memories.",
};
const FINISH_NO_CAP: TourStep = {
  id: 'finish', targetId: null, screen: 'Home',
  title: "You're all set 🎉", body: 'Join a capsule or start your own whenever you like.',
};

export function buildTourSteps(ctx: { hasCapsule: boolean; capsuleId: string | null }): TourStep[] {
  if (ctx.hasCapsule && ctx.capsuleId) {
    const p = { capsuleId: ctx.capsuleId };
    return [
      { id: 'card', targetId: 'capsule-card', screen: 'Home', title: 'Your first capsule', body: "It's sealed until its unlock date. Let's look inside." },
      { id: 'countdown', targetId: 'capsule-countdown', screen: 'CapsuleDetail', params: p, title: 'Everyone unlocks together', body: 'The photos reveal for everyone the moment this countdown hits zero.' },
      { id: 'add-media', targetId: 'capsule-add-media', screen: 'CapsuleDetail', params: p, title: 'Add your photos', body: 'Drop in photos and videos here — they stay hidden until it unlocks.' },
      { id: 'invite', targetId: 'capsule-invite', screen: 'CapsuleDetail', params: p, title: 'Better with people', body: 'Invite your crew. They add their photos too, and everyone reveals together.' },
      { id: 'awards', targetId: 'capsule-awards', screen: 'CapsuleDetail', params: p, title: 'Fun awards', body: 'After it unlocks, everyone votes on these. Tweak them now if you like.' },
      { id: 'scan', targetId: 'home-scan', screen: 'Home', title: "Joining a friend's capsule", body: 'Got an invite? Scan their QR code or open their link to jump into a capsule too — no setup needed.' },
      { id: 'camera', targetId: 'tab:Camera', screen: 'Home', title: 'Capture anytime', body: 'Tap the camera to shoot straight into a capsule.' },
      { id: 'alerts', targetId: 'tab:Notifications', screen: 'Home', title: 'Your alerts', body: 'Invites and unlock alerts land here.' },
      { id: 'profile', targetId: 'tab:Profile', screen: 'Home', title: 'You', body: 'Profile, friends, and settings live here.' },
      FINISH_WITH_CAP,
    ];
  }
  return [
    { id: 'scan', targetId: 'home-scan', screen: 'Home', title: 'Joining is the fastest start', body: "Got an invite? Scan a friend's QR code or open their link to jump straight into their capsule." },
    { id: 'create', targetId: 'tab:Create', screen: 'Home', title: 'Or start your own', body: "Whenever you're ready, tap Create to make your own time-locked capsule." },
    { id: 'camera', targetId: 'tab:Camera', screen: 'Home', title: 'Capture anytime', body: 'Tap the camera to shoot a photo or video — it flows into a capsule.' },
    { id: 'alerts', targetId: 'tab:Notifications', screen: 'Home', title: 'Your alerts', body: 'Invites and unlock alerts land here.' },
    { id: 'profile', targetId: 'tab:Profile', screen: 'Home', title: 'You', body: 'Profile, friends, and settings live here.' },
    FINISH_NO_CAP,
  ];
}
