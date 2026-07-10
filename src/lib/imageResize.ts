import { Image } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';

const MAX_WIDTH = 1920;

function getWidth(uri: string): Promise<number | null> {
  return new Promise(resolve => {
    Image.getSize(
      uri,
      (width) => resolve(width),
      () => resolve(null),
    );
  });
}

/**
 * Downscales an image to MAX_WIDTH wide (never upscales) and re-compresses.
 * Shared by CameraScreen (already-captured photos are typically already at
 * or under this size, so the width check makes this a fast no-op there) and
 * the upload queue (library/share-intent photos, which otherwise upload at
 * full device resolution — 5-10x the bytes for no visual gain at display
 * size). Uses Image.getSize (a header read, not a decode) to check width
 * first — ImageManipulator's resize action doesn't guard against upscaling
 * on its own, and running it unconditionally would also force a wasteful
 * re-encode pass on images that don't need one.
 */
export async function resizeForUpload(uri: string): Promise<string> {
  const width = await getWidth(uri);
  if (typeof width === 'number' && width <= MAX_WIDTH) {
    return uri;
  }

  const result = await ImageManipulator.manipulateAsync(
    uri, [{ resize: { width: MAX_WIDTH } }], { compress: 0.82 }
  );
  return result.uri;
}
