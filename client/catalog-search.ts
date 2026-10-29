import Fuse from 'fuse.js';

export interface SearchableCatalogEntry {
  id: string;
  name: string;
  description: string;
  title?: string;
  keywords?: readonly string[];
}

interface IndexedEntry {
  entry: SearchableCatalogEntry;
  name: string;
  description: string;
  title: string;
  keywords: string[];
}

const indexes = new WeakMap<readonly SearchableCatalogEntry[], Fuse<IndexedEntry>>();
const normalize = (value: string): string => value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim();

/** Catalog arrays are immutable snapshots: replace the array when its content changes. */
export function searchCatalog<T extends SearchableCatalogEntry>(entries: readonly T[], query: string): T[] {
  const terms = [...new Set(normalize(query).split(' ').filter(Boolean))];
  if (!terms.length) return [...entries];

  let index = indexes.get(entries);
  if (!index) {
    index = new Fuse<IndexedEntry>(entries.map(entry => ({
      entry,
      name: normalize(entry.name),
      description: normalize(entry.description),
      title: normalize(entry.title ?? ''),
      keywords: (entry.keywords ?? []).map(normalize),
    })), {
      keys: [
        { name: 'name', weight: 4 },
        { name: 'title', weight: 2 },
        { name: 'keywords', weight: 2 },
        { name: 'description', weight: 1 },
      ],
      ignoreLocation: true,
      // One typo in a 3+ character word is allowed; 1–2 character queries stay exact.
      threshold: 0.34,
    });
    indexes.set(entries, index);
  }

  return index.search({
    $and: terms.map(term => ({
      $or: ['name', 'title', 'keywords', 'description'].map(key => ({ [key]: term })),
    })),
  }).map(result => result.item.entry as T);
}
