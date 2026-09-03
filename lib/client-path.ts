'use client';

const AUSBUG_PROXY_HOSTS = new Set(['ausbug.app', 'vicbug.app', 'www.vicbug.app']);

export function ltsAppPath(path: string, hostname = typeof window === 'undefined' ? '' : window.location.hostname): string {
  if (!path.startsWith('/')) return path;
  if (AUSBUG_PROXY_HOSTS.has(hostname)) {
    return `/ltsmap${path}`;
  }
  return path;
}
