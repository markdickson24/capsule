// Touch-ownership rule for MediaViewerModal's PanResponder. Pure so it can be
// asserted under tsx.
//
// Videos render with expo-video's native controls, whose timebar is a native
// view outside React Native's responder system. A JS responder that claims
// every touch sees a timebar drag as a horizontal swipe and pages to the next
// item mid-scrub. On a video slide, a touch that STARTS in the thin band at the
// bottom where the timebar sits is left entirely to the native controls; the
// rest of the video still pages/dismisses.

/** Height of the band above the bottom edge left to the video timebar, in points. */
export const VIDEO_TIMEBAR_ZONE_PT = 140;

/** Whether the viewer's PanResponder should take a touch starting at `pageY`. */
export function viewerClaimsTouch(isVideo: boolean, pageY: number, screenHeight: number): boolean {
  if (!isVideo) return true;
  return pageY < screenHeight - VIDEO_TIMEBAR_ZONE_PT;
}
