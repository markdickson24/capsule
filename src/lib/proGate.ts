import { presentPaywall } from './purchases';
import { toast } from './toast';

// Called when a Pro cap is hit. The host (prospective or actual owner) is shown
// the paywall — upgrading lifts the cap. A guest is only informed, never
// upsold, because the guest upgrading would NOT lift a host-based cap.
export function proGateHit(params: { currentUserIsHost: boolean; guestMessage: string }): void {
  if (params.currentUserIsHost) {
    presentPaywall(); // native-only; web stub no-ops
  } else {
    toast.show(params.guestMessage);
  }
}
