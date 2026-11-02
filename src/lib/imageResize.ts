import { Image } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import { thumbResize } from './thumbSize';

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

function getSize(uri: string): Promise<{ width: number; height: number } | null> {
  return new Promise(resolve => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      () => resolve(null),
    );
  });
}

/**
 * Small JPEG stored alongside each photo as `media.thumbnail_key`, so the grid
 * never asks Supabase's render API to resize the original. That API bills per
 * distinct origin image (100/month on Pro), and routing every grid cell
 * through it was the whole Image Transformations overage. Keeps the aspect
 * ratio (see thumbResize) so it also works as the
 * contain-fit placeholder in the full-screen viewer; the grid crops it with
 * contentFit="cover".
 */
export async function makeGridThumbnail(uri: string): Promise<{ uri: string; mimeType: string }> {
  const resize = thumbResize(await getSize(uri));
  const action = resize ? [{ resize }] : [];
  const result = await ImageManipulator.manipulateAsync(uri, action, {
    compress: 0.7,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return { uri: result.uri, mimeType: 'image/jpeg' };
}
