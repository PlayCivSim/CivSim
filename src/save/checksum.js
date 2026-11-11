// FNV-1a over the save text: detects truncated or damaged records cheaply.
// Shared by the simulation worker (when writing) and the save store (when reading).
export function checksum(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36) + ':' + str.length;
}
