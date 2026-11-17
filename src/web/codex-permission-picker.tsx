import type { RuntimeStatus, TaskPermissions } from '../shared.ts';
import { ActionMenu } from './action-menu.tsx';
import { permissionDetail, permissionText } from './task-permissions.tsx';
import { CodexIcon } from './codex-icons.tsx';
import { t } from './i18n.ts';

export function CodexPermissionPicker({ runtime, value, disabled, canChange = true, hint, onChange }: {
  runtime?: RuntimeStatus; value: TaskPermissions; disabled?: boolean; canChange?: boolean; hint?: string; onChange: (value: TaskPermissions) => void;
}) {
  const options = runtime?.permissionOptions || [], selected = options.find(option => option.value === value);
  if (!options.length) return null;
  const detail = selected ? permissionDetail(selected.detail) || selected.detail : '';
  return <ActionMenu label={t('Permissions')} description={[selected ? permissionText(selected.label) : '', detail].filter(Boolean).join(' · ')}
    className="codex-ghost codex-permissions" menuClassName="codex-action-menu codex-permission-menu" disabled={disabled}
    actions={[
      ...options.map(option => ({ id: option.value, label: permissionText(option.label), detail: permissionDetail(option.detail) || option.detail,
        checked: option.value === value, disabled: !canChange, select: () => onChange(option.value) })),
      ...(!canChange ? [{ label: hint || t('Pause to change'), disabled: true }] : []),
    ]}>
    <CodexIcon name="shield" size={18}/><span className="agent-permission-label">{selected ? permissionText(selected.label) : t('Permissions')}</span><CodexIcon name="chevronDown" size={12}/>
  </ActionMenu>;
}
