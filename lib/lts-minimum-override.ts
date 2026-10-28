import { isLtsVoteLevel } from './lts-voting';

/** A server-side review can waive the floor for one exact approval only.
 * New votes/approvals and reconciliation requiring review invalidate the waiver.
 * This field is never accepted from the public vote request.
 */
export function hasReviewedMinimumOverride(value: object): boolean {
  const record = value as Record<string, unknown>;
  const review = record.minimumRatingOverride as Record<string, unknown> | undefined;
  return record.status === 'current'
    && typeof record.dataset === 'string'
    && /^segment:w[1-9][0-9]*$/.test(String(record.segmentId))
    && isLtsVoteLevel(record.approvedLts)
    && typeof record.approvedAt === 'string' && !!record.approvedAt
    && review?.approvedAt === record.approvedAt
    && review?.approvedLts === record.approvedLts
    && typeof review?.reason === 'string' && !!review.reason.trim();
}
