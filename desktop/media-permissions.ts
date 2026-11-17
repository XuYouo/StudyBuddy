interface FrameDetails { isMainFrame?: boolean; requestingUrl?: string; securityOrigin?: string }
function sameOrigin(value: string | undefined, origin: string) {
  try { return !!origin && !!value && new URL(value).origin === origin; } catch { return false; }
}
function workspaceFrame(trustedContents: boolean, origin: string, details: FrameDetails) {
  return trustedContents && details.isMainFrame === true && sameOrigin(details.requestingUrl, origin)
    && (!details.securityOrigin || sameOrigin(details.securityOrigin, origin));
}
// Only the main workspace can request microphone audio. Review frames,
// other windows, cameras and screen capture stay denied.
export function microphoneRequest(trustedContents: boolean, origin: string, permission: string, details: FrameDetails & { mediaTypes?: string[] }) {
  return permission === 'media' && workspaceFrame(trustedContents, origin, details)
    && details.mediaTypes?.length === 1 && details.mediaTypes[0] === 'audio';
}
export function workspacePermissionCheck(trustedContents: boolean, origin: string, permission: string, requestingOrigin: string, details: FrameDetails & { mediaType?: string }) {
  if (!trustedContents || !sameOrigin(requestingOrigin, origin)) return false;
  // Preserve copy buttons in the workspace and same-origin review frames.
  if (permission === 'clipboard-sanitized-write') return sameOrigin(details.requestingUrl, origin);
  return permission === 'media' && details.mediaType === 'audio' && workspaceFrame(trustedContents, origin, details);
}
