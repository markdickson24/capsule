// Classifies the two media errors Sentry kept reporting that aren't bugs:
//  - PHOTO_LIMIT_REACHED (REACT-NATIVE-F): the `enforce_photo_limit` trigger
//    rejected the `media` insert because the capsule is at its owner's cap.
//    Retrying can never succeed, so it isn't a retryable failed tile.
//  - PHPhotosErrorDomain 3164 (REACT-NATIVE-3): the iOS photo picker couldn't
//    download a picked item from iCloud (no network / iCloud throttled). The
//    picker promise rejects; before this it was an unhandled rejection with no
//    feedback to the user.
// No react-native import: Tier 0 tested in mediaErrors.test.ts.

export const PHOTO_LIMIT_ERROR = 'PHOTO_LIMIT_REACHED';

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return typeof err === 'string' ? err : '';
}

/** True when an upload failed because the capsule is already full. */
export function isPhotoLimitError(err: unknown): boolean {
  return messageOf(err).includes(PHOTO_LIMIT_ERROR);
}

/** True when the iOS photo picker failed to fetch an iCloud-only asset. */
export function isICloudPickerError(err: unknown): boolean {
  return /PHPhotosErrorDomain error 3164/.test(messageOf(err));
}

export const ICLOUD_PICKER_MESSAGE =
  "Couldn't load that from iCloud. Check your connection and try again.";
export const PICKER_FAILED_MESSAGE = "Couldn't open that item. Try another one.";

/** Toast copy for a rejected photo-picker call. */
export function pickerErrorMessage(err: unknown): string {
  return isICloudPickerError(err) ? ICLOUD_PICKER_MESSAGE : PICKER_FAILED_MESSAGE;
}

/** End-of-batch toast for the upload queue. Null when nothing happened. */
export function uploadBatchToast(added: number, failed: number, limitHit: number): string | null {
  const noun = (n: number) => (n === 1 ? 'item' : 'items');
  const parts: string[] = [];
  if (added > 0) parts.push(`${added} ${noun(added)} added`);
  if (failed > 0) parts.push(added > 0 ? `${failed} failed` : 'Upload failed — tap the item to retry');
  if (limitHit > 0) {
    parts.push(
      added > 0 || failed > 0
        ? `${limitHit} didn't fit — capsule is full`
        : `This capsule is full — ${limitHit} ${noun(limitHit)} couldn't be added`,
    );
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}
