/**
 * Hand a file to the browser as a download — the only way anything leaves the app, and only when
 * the player asks (the owner's diagnostics export, M112). Nothing is uploaded.
 */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next task: the click has started the download by then.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
