// Which media-viewer slides may hold a live video player.
//
// The viewer lays every capsule item side by side and slides the row with
// translateX, so every slide is mounted for as long as the viewer is open.
// Each mounted video slide owns an expo-video player, and creating one runs
// AVURLAsset's init synchronously on the main thread (an XPC round-trip to
// mediaserverd). Opening the viewer on a capsule with many videos created all
// of those players at once: REACT-NATIVE-H / -K ("App hanging for at least
// 2000 ms" in VideoAsset.init / VideoPlayerItem.init), and the memory they hold
// is the likely cause of the WatchdogTermination in REACT-NATIVE-8.
//
// Only the current slide and its immediate neighbours get a player, so a swipe
// still lands on a video that has already started loading.

/** Slides on each side of the current one that keep a live player. */
export const VIDEO_PLAYER_RADIUS = 1;

export function shouldMountVideoPlayer(index: number, currentIndex: number): boolean {
  return Math.abs(index - currentIndex) <= VIDEO_PLAYER_RADIUS;
}
