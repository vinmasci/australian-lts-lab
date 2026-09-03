import { list, put } from '@vercel/blob';

const PREFIX = 'ausbug-lts-votes/v1';

interface DevelopmentStore {
  records: Map<string, string>;
}

declare global {
  var __ausbugLtsVoteStore: DevelopmentStore | undefined;
}

function developmentStore(): DevelopmentStore {
  globalThis.__ausbugLtsVoteStore ??= { records: new Map() };
  return globalThis.__ausbugLtsVoteStore;
}

function blobConfigured(): boolean {
  if (process.env.NODE_ENV !== 'production' && process.env.LTS_VOTE_USE_BLOB_LOCALLY !== 'true') return false;
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || (process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID));
}

function fullPath(pathname: string): string {
  return `${PREFIX}/${pathname}`;
}

export async function writeVoteRecord(pathname: string, value: unknown): Promise<void> {
  const body = JSON.stringify(value);
  if (!blobConfigured()) {
    if (process.env.NODE_ENV === 'production') throw new Error('Community voting storage is not configured.');
    developmentStore().records.set(fullPath(pathname), body);
    return;
  }
  await put(fullPath(pathname), body, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 60,
  });
}

export async function readVoteRecord<T>(pathname: string): Promise<T | null> {
  const target = fullPath(pathname);
  if (!blobConfigured()) {
    const value = developmentStore().records.get(target);
    return value ? JSON.parse(value) as T : null;
  }
  const result = await list({ prefix: target, limit: 2 });
  const blob = result.blobs.find((item) => item.pathname === target);
  if (!blob) return null;
  const response = await fetch(blob.url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Vote storage returned ${response.status}.`);
  return await response.json() as T;
}

export async function listVoteRecords<T>(prefix: string, maximum = 1000): Promise<T[]> {
  const target = fullPath(prefix);
  if (!blobConfigured()) {
    return [...developmentStore().records.entries()]
      .filter(([pathname]) => pathname.startsWith(target))
      .slice(0, maximum)
      .map(([, value]) => JSON.parse(value) as T);
  }

  const values: T[] = [];
  let cursor: string | undefined;
  do {
    const result = await list({ prefix: target, cursor, limit: Math.min(1000, maximum - values.length) });
    const records = await Promise.all(result.blobs.map(async (blob) => {
      const response = await fetch(blob.url, { cache: 'no-store' });
      if (!response.ok) return null;
      return await response.json() as T;
    }));
    for (const record of records) {
      if (record !== null) values.push(record as T);
    }
    cursor = result.hasMore && values.length < maximum ? result.cursor : undefined;
  } while (cursor);
  return values;
}
