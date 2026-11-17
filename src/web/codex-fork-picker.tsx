import type { RefObject } from 'react';
import { ComposerActionPicker, type ComposerActionControl } from './composer-action-picker.tsx';
import { CodexIcon } from './codex-icons.tsx';
import { t, useLanguage } from './i18n.ts';

export function CodexForkPicker({ controlRef, disabled, fork }: { controlRef: RefObject<ComposerActionControl | null>; disabled?: boolean; fork(): Promise<void> }) {
  useLanguage();
  return <ComposerActionPicker<'worktree'> controlRef={controlRef} disabled={disabled} label={t('Fork chat')} loadingLabel={t('Loading…')} loadError={t('Unable to load fork options')} selectError={t('Failed to fork chat')}
    load={async () => [{ id: 'worktree', title: t('Fork chat'), description: t('Fork this chat in a new worktree'), icon: <CodexIcon name="laptop" size={16}/>, value: 'worktree' }]} select={fork}/>;
}
