import type { AgentId } from '../shared.ts';
import { t } from './i18n.ts';

// These describe the adapters' detection rules, not the user's whole machine.
export function agentSetup(id: AgentId) {
  const cli = {
    codex: ['codex', 'PAPILOT_CODEX_BIN'], claude: ['claude', 'PAPILOT_CLAUDE_BIN'],
    copilot: ['copilot', 'PAPILOT_COPILOT_BIN'], grok: ['grok', 'PAPILOT_GROK_BIN'],
    antigravity: ['agy', 'PAPILOT_AGY_BIN'], kimi: ['kimi', 'PAPILOT_KIMI_BIN'],
    deepseek: ['dsh', 'PAPILOT_DSH_BIN'], qwen: ['qwen', 'PAPILOT_QWEN_BIN'], opencode: ['opencode', 'PAPILOT_OPENCODE_BIN'],
  };
  if (id === 'cursor') return {
    summary: t('Cursor SDK credentials were not detected.'),
    reason: t('The last connection attempt found neither CURSOR_API_KEY nor a saved Cursor SDK login for the user running StudyBuddy. Signing in to the Cursor desktop app or CLI does not configure this SDK.'),
    steps: [t('Create a Cursor API key in the Cursor dashboard, or configure the Cursor SDK login on this host.'), t('Provide CURSOR_API_KEY to the process or service that starts StudyBuddy, then restart StudyBuddy. The SDK is installed automatically when used.')],
    existing: t('An environment variable set in a new terminal does not reach an already running server. Restart StudyBuddy with the credentials; Reconnect alone cannot change its environment.'),
  };
  if (id === 'papilot') return {
    summary: t('StudyBuddy Writer needs a model provider.'),
    reason: t('StudyBuddy Writer is built into StudyBuddy. It runs on a model from your ChatGPT or GitHub Copilot subscription, or from a provider API key.'),
    steps: [t('Sign in with a subscription or add an API key in Settings → Agents → StudyBuddy Writer.')],
    existing: t('Keys set in the environment that starts StudyBuddy are used as well. Restart StudyBuddy after changing its environment.'),
  };
  if (id === 'glm') return {
    summary: t('No GLM API key was found.'),
    reason: t('The last connection attempt found neither ZHIPU_API_KEY nor ZAI_API_KEY in the StudyBuddy server environment. A Claude login or a GLM website login does not supply these keys.'),
    steps: [t('Create a GLM Coding Plan or API key with Zhipu or Z.ai.'), t('Set ZHIPU_API_KEY for open.bigmodel.cn, or ZAI_API_KEY for api.z.ai, in the environment that starts StudyBuddy. Then restart StudyBuddy.')],
    existing: t('An environment variable set in a new terminal does not reach an already running server. Restart StudyBuddy with the credentials; Reconnect alone cannot change its environment.'),
  };
  const [command, variable] = cli[id];
  return {
    summary: id === 'claude' ? t('Claude Code or API credentials were not detected.') : t('{command} was not found by StudyBuddy.', { command }),
    reason: id === 'claude'
      ? t('The last connection attempt found neither Claude Code nor supported API credentials in the StudyBuddy server environment.')
      : t('The last connection attempt could not find a runnable {command} CLI in the StudyBuddy server environment. It may still be installed in another location or for another user.', { command }),
    steps: [
      t('Install {command} on the host running StudyBuddy, then complete its login or provider setup below.', { command }),
      t('If it is already installed, set {variable} to its executable path in the environment that starts StudyBuddy, then restart StudyBuddy.', { variable }),
      ...(id === 'claude' ? [t('For the SDK instead, start StudyBuddy with ANTHROPIC_API_KEY or a supported cloud provider configured. Restart StudyBuddy after changing its environment.')] : []),
    ],
    existing: t('The browser and the StudyBuddy server may run on different computers. Background services can also use a different PATH or user account from your terminal.'),
  };
}
