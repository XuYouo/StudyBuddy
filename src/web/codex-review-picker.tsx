import type { RefObject } from 'react';
import type { CodeReviewBranches, CodeReviewTarget } from '../code-review.ts';
import { ComposerActionPicker, type ComposerActionControl, type ComposerActionChoice } from './composer-action-picker.tsx';
import { t, useLanguage } from './i18n.ts';

export type CodeReviewControl = ComposerActionControl;

export function CodexReviewPicker({ controlRef, disabled, load, review }: {
  controlRef: RefObject<CodeReviewControl | null>; disabled?: boolean;
  load(signal: AbortSignal): Promise<CodeReviewBranches>;
  review(target: CodeReviewTarget): Promise<void>;
}) {
  useLanguage();
  const first: ComposerActionChoice<CodeReviewTarget> = { id: 'uncommitted', title: t('Review uncommitted changes'), value: { type: 'uncommittedChanges' } };
  return <ComposerActionPicker controlRef={controlRef} disabled={disabled} label={t('Code review')} loadingLabel={t('Loading branches…')} loadError={t('Unable to load branches')} selectError={t('Failed to start code review')} initialChoices={[first]}
    load={async signal => [first, ...(await load(signal)).branches.map(branch => ({ id: branch.ref, title: branch.name, value: { type: 'baseBranch' as const, branch: branch.ref }, group: t('Review against a base branch') }))]} select={review}/>;
}
