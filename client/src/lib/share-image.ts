import { whatsappShareUrl } from '@rivoora/shared';

export type ShareOutcome = 'shared' | 'fallback' | 'cancelled';

const extOf = (blob: Blob, url: string) => {
  const t = blob.type.split('/')[1];
  if (t) return t === 'jpeg' ? 'jpg' : t;
  return /\.(\w{3,4})(\?|$)/.exec(url)?.[1] ?? 'webp';
};

/**
 * Share a photo with a text (Sprint 15). Phones / tablets: the Web Share API with the image FILE, so the share sheet
 * offers WhatsApp. Elsewhere: open `wa.me/?text=` and download the image so it can be attached by hand.
 * Throws a friendly Error when the image cannot be fetched.
 */
export async function shareImage(url: string, text: string, baseName = 'damage'): Promise<ShareOutcome> {
  let blob: Blob;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    blob = await res.blob();
  } catch {
    throw new Error("Couldn't load the photo to share. Check your connection and try again.");
  }
  const file = new File([blob], `${baseName}.${extOf(blob, url)}`, { type: blob.type || 'image/webp' });
  if (typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      // any other failure: fall through to the WhatsApp link + download
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  window.open(whatsappShareUrl(text), '_blank', 'noopener');
  return 'fallback';
}
