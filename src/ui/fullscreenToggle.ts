/** User-gesture fullscreen for couch / console browsers (vendor-prefixed where needed). */

const APP_ID = "app";

export function isDocumentFullscreen(): boolean {
  return (
    document.fullscreenElement !== null ||
    (document as unknown as { webkitFullscreenElement?: Element | null })
      .webkitFullscreenElement !== null
  );
}

export function requestAppFullscreen(): Promise<void> {
  const el =
    (document.getElementById(APP_ID) as HTMLElement | null) ?? document.documentElement;
  const anyEl = el as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
  };
  if (typeof anyEl.requestFullscreen === "function") {
    return Promise.resolve(anyEl.requestFullscreen());
  }
  if (typeof anyEl.webkitRequestFullscreen === "function") {
    return Promise.resolve(anyEl.webkitRequestFullscreen());
  }
  return Promise.reject(new Error("Fullscreen API unavailable"));
}

export function exitAppFullscreen(): Promise<void> {
  if (typeof document.exitFullscreen === "function") {
    return Promise.resolve(document.exitFullscreen());
  }
  const d = document as Document & {
    webkitExitFullscreen?: () => Promise<void> | void;
  };
  if (typeof d.webkitExitFullscreen === "function") {
    return Promise.resolve(d.webkitExitFullscreen());
  }
  return Promise.reject(new Error("Exit fullscreen unavailable"));
}

export function toggleAppFullscreen(): Promise<void> {
  if (isDocumentFullscreen()) {
    return exitAppFullscreen();
  }
  return requestAppFullscreen();
}
