/** Route the two ZIP formats accepted by the editor's single scan import entry. */
export function classifyScanZipEntries(names: readonly string[]): 'house-capture' | 'roomplan' | 'unsupported' {
  const files = names.filter(name => !name.endsWith('/'));
  const hasManifest = files.some(name => /(^|\/)manifest\.json$/i.test(name));
  const hasIndexedRoom = files.some(name => /(^|\/)rooms\/room-[0-9]+\.json$/i.test(name));
  if (hasManifest && hasIndexedRoom) return 'house-capture';
  if (files.some(name => /(^|\/)room\.json$/i.test(name))) return 'roomplan';
  return 'unsupported';
}
