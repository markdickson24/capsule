import assert from 'node:assert/strict';
import {
  isPhotoLimitError,
  isICloudPickerError,
  pickerErrorMessage,
  uploadBatchToast,
  ICLOUD_PICKER_MESSAGE,
  PICKER_FAILED_MESSAGE,
} from './mediaErrors';

// runTask rethrows the Supabase insert error as `new Error(error.message)` (REACT-NATIVE-F)
assert.equal(isPhotoLimitError(new Error('PHOTO_LIMIT_REACHED')), true);
// A raw PostgrestError object also counts
assert.equal(isPhotoLimitError({ message: 'PHOTO_LIMIT_REACHED', code: 'P0001' }), true);
// Ordinary network/storage failures stay retryable
assert.equal(isPhotoLimitError(new Error('Upload timed out')), false);
assert.equal(isPhotoLimitError(null), false);

// The exact expo CodedError text from REACT-NATIVE-3
const icloud = new Error('The operation couldn’t be completed. (PHPhotosErrorDomain error 3164.)');
assert.equal(isICloudPickerError(icloud), true);
assert.equal(pickerErrorMessage(icloud), ICLOUD_PICKER_MESSAGE);
// Any other picker rejection gets the generic copy
assert.equal(isICloudPickerError(new Error('PHPhotosErrorDomain error 3300')), false);
assert.equal(pickerErrorMessage(new Error('boom')), PICKER_FAILED_MESSAGE);

// Existing batch toasts are unchanged
assert.equal(uploadBatchToast(1, 0, 0), '1 item added');
assert.equal(uploadBatchToast(3, 1, 0), '3 items added · 1 failed');
assert.equal(uploadBatchToast(0, 2, 0), 'Upload failed — tap the item to retry');
// Nothing happened → no toast
assert.equal(uploadBatchToast(0, 0, 0), null);
// Whole batch bounced off the cap: say so instead of "tap to retry"
assert.equal(uploadBatchToast(0, 0, 2), "This capsule is full — 2 items couldn't be added");
// Some fit before the capsule filled up
assert.equal(uploadBatchToast(4, 0, 1), "4 items added · 1 didn't fit — capsule is full");

console.log('mediaErrors: all assertions passed');
