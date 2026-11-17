import type { AgentId, AgentModel } from '../shared.ts';

export interface ComposerModelConfiguration { agent: AgentId; model: string; effort: string; fast: boolean }

// Keep only capabilities actually advertised by the chosen model. A saved
// recent configuration is revalidated too: available models can change.
export function modelConfiguration(agent: AgentId, model: AgentModel | undefined, previous: Pick<ComposerModelConfiguration, 'effort' | 'fast'>, id = model?.id || ''): ComposerModelConfiguration {
  return { agent, model: id,
    effort: model?.efforts.includes(previous.effort) ? previous.effort : model?.defaultEffort && model.efforts.includes(model.defaultEffort) ? model.defaultEffort : '',
    fast: agent === 'codex' && Boolean(model?.fastMode && previous.fast),
  };
}

export const configurationKey = (value: ComposerModelConfiguration) => JSON.stringify([value.agent, value.model, value.effort, value.fast]);

export function recentConfigurations(value: unknown): ComposerModelConfiguration[] {
  if (!Array.isArray(value)) return [];
  const found = new Map<string, ComposerModelConfiguration>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || typeof item.agent !== 'string' || typeof item.model !== 'string' || typeof item.effort !== 'string' || typeof item.fast !== 'boolean') continue;
    const config = { agent: item.agent as AgentId, model: item.model, effort: item.effort, fast: item.fast };
    found.set(configurationKey(config), config);
  }
  return [...found.values()].slice(0, 3);
}
