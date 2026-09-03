import { createHash } from 'node:crypto';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, type DocumentData, type Firestore } from 'firebase-admin/firestore';

const COLLECTIONS = ['ltsDatasets', 'ltsSegments', 'ltsApprovals', 'ltsPublishedSegments', 'ltsSegmentAliases'] as const;
const apply = process.argv.includes('--apply');

function credential(name: string): Parameters<typeof cert>[0] {
  const encoded = process.env[name]?.trim();
  if (!encoded) throw new Error(`${name} is required.`);
  return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as Parameters<typeof cert>[0];
}

const sourceProject = (process.env.SOURCE_FIREBASE_PROJECT_ID || 'ausbug-maps').trim();
const targetProject = (process.env.TARGET_FIREBASE_PROJECT_ID || 'cyaroutes').trim();
if (sourceProject === targetProject) throw new Error('Source and target projects must differ.');

const source = getFirestore(initializeApp({ credential: cert(credential('SOURCE_FIREBASE_SERVICE_ACCOUNT_BASE64')), projectId: sourceProject }, `lts-source-${Date.now()}`));
const target = getFirestore(initializeApp({ credential: cert(credential('TARGET_FIREBASE_SERVICE_ACCOUNT_BASE64')), projectId: targetProject }, `lts-target-${Date.now()}`));

interface Inventory {
  documents: Map<string, DocumentData>;
  votes: Map<string, DocumentData>;
}

async function inventory(db: Firestore): Promise<Inventory> {
  const documents = new Map<string, DocumentData>();
  const votes = new Map<string, DocumentData>();
  for (const collectionName of COLLECTIONS) {
    const snapshot = await db.collection(collectionName).get();
    for (const document of snapshot.docs) {
      documents.set(`${collectionName}/${document.id}`, document.data());
      if (collectionName === 'ltsSegments') {
        const voteSnapshot = await document.ref.collection('votes').get();
        for (const vote of voteSnapshot.docs) votes.set(`${collectionName}/${document.id}/votes/${vote.id}`, vote.data());
      }
    }
  }
  return { documents, votes };
}

function normal(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normal);
  if (value && typeof value === 'object') {
    if ('toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function') {
      return (value as { toDate(): Date }).toDate().toISOString();
    }
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, normal(item)]));
  }
  return value;
}

function fingerprint(records: Map<string, DocumentData>): string {
  const serialised = [...records.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([path, value]) => [path, normal(value)]);
  return createHash('sha256').update(JSON.stringify(serialised)).digest('hex');
}

async function copyRecords(records: Map<string, DocumentData>) {
  for (const [path, value] of records) await target.doc(path).set(value);
}

async function main() {
  const sourceInventory = await inventory(source);
  const initialTarget = await inventory(target);
  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    sourceProject,
    targetProject,
    sourceDocuments: sourceInventory.documents.size,
    sourceVotes: sourceInventory.votes.size,
    targetDocumentsBefore: initialTarget.documents.size,
    targetVotesBefore: initialTarget.votes.size,
  }));
  if (!apply) return;

  await copyRecords(sourceInventory.documents);
  await copyRecords(sourceInventory.votes);
  const finalTarget = await inventory(target);
  const sourceDocumentFingerprint = fingerprint(sourceInventory.documents);
  const targetDocumentSubset = new Map([...finalTarget.documents].filter(([path]) => sourceInventory.documents.has(path)));
  const sourceVoteFingerprint = fingerprint(sourceInventory.votes);
  const targetVoteSubset = new Map([...finalTarget.votes].filter(([path]) => sourceInventory.votes.has(path)));
  const documentMatch = sourceDocumentFingerprint === fingerprint(targetDocumentSubset);
  const voteMatch = sourceVoteFingerprint === fingerprint(targetVoteSubset);
  console.log(JSON.stringify({
    copiedDocuments: sourceInventory.documents.size,
    copiedVotes: sourceInventory.votes.size,
    targetDocumentsAfter: finalTarget.documents.size,
    targetVotesAfter: finalTarget.votes.size,
    documentMatch,
    voteMatch,
  }));
  if (!documentMatch || !voteMatch) throw new Error('Target verification failed; the application has not been switched.');
}

void main();
