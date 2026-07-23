import { presentPaywall } from './purchases';
import { limitSheet } from './limitSheet';

// Called when a Pro cap is hit, mid-action. Shows the smooth in-app limit sheet
// instead of jumping to the native paywall (owner) or a bare toast (guest).
// Owner → Upgrade action opens the hosted RevenueCat paywall; guest → explain
// only (a guest upgrading wouldn't lift a host-based cap).
export function proGateHit(params: {
  currentUserIsHost: boolean;
  guestMessage: string;
  title?: string;
  ownerMessage?: string;
}): void {
  if (params.currentUserIsHost) {
    limitSheet.show({
      title: params.title ?? 'Capsule Pro',
      message: params.ownerMessage ?? 'Upgrade to Capsule Pro to lift this limit.',
      icon: 'sparkles',
      actions: [
        { label: 'Upgrade to Capsule Pro', style: 'primary', onPress: () => { presentPaywall(); } },
        { label: 'Not now', style: 'secondary', onPress: () => {} },
      ],
    });
  } else {
    limitSheet.show({
      title: params.title ?? 'This capsule is full',
      message: params.guestMessage,
      icon: 'lock-closed',
      actions: [{ label: 'Got it', style: 'secondary', onPress: () => {} }],
    });
  }
}
