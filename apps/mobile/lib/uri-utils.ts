export function appendUniqueUri(list: string[], uri: string): string[] {
  return list.includes(uri) ? list : [...list, uri];
}
