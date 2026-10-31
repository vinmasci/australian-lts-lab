/** A preview must read live approvals rather than treating an empty local store as no restrictions. */
export function approvalSource(options: {
  firestore: boolean; development: boolean; preview: boolean; publicRead: boolean; blob: boolean;
}): 'firestore' | 'public' | 'blob' {
  if (options.firestore) return 'firestore';
  if (options.development || options.preview || options.publicRead) return 'public';
  if (options.blob) return 'blob';
  throw new Error('Published community restriction storage is not configured. Routing is temporarily unavailable.');
}
