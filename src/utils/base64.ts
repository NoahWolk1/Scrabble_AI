/** Safe base64 for large buffers (avoids spread/call stack limits on huge arrays). */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.length;
  const chunk = 0x8000;
  for (let i = 0; i < len; i += chunk) {
    const sub = bytes.subarray(i, Math.min(i + chunk, len));
    binary += String.fromCharCode.apply(null, sub as unknown as number[]);
  }
  return btoa(binary);
}
