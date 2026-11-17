export type CodeReviewTarget = { type: 'uncommittedChanges' } | { type: 'baseBranch'; branch: string };
export type CodeReviewBranch = { name: string; ref: string };
export type CodeReviewBranches = { current: string | null; branches: CodeReviewBranch[] };
