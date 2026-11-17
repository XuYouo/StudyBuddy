import type { AgentId, ApprovalChoice } from '../shared.ts';

interface ApprovalOption extends ApprovalChoice { response: unknown }
const command = 'item/commandExecution/requestApproval';
const file = 'item/fileChange/requestApproval';
const permissions = 'item/permissions/requestApproval';
const record = (value: unknown): value is Record<string, any> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const prefix = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0
  && typeof value[0] === 'string' && value[0].trim().length > 0
  && value.every(part => typeof part === 'string' && !/[\r\n\0]/.test(part));
const networkRule = (value: unknown): value is { host: string; action: 'allow' | 'deny' } => record(value)
  && typeof value.host === 'string' && value.host.trim().length > 0 && !/[\r\n\0]/.test(value.host)
  && (value.action === 'allow' || value.action === 'deny') && Object.keys(value).every(key => key === 'host' || key === 'action');

// A response grants only the profile the runtime asked for. Request profiles
// have nullable members; granted profiles omit those members instead.
function permissionGrant(value: unknown): Record<string, unknown> | undefined {
  if (!record(value)) return;
  const result: Record<string, unknown> = {};
  for (const key of ['network', 'fileSystem']) {
    if (value[key] == null) continue;
    if (!record(value[key])) return;
    result[key] = value[key];
  }
  return Object.keys(result).length ? result : undefined;
}

function nativeOption(decision: unknown, index: number, method: string): ApprovalOption | undefined {
  if (typeof decision === 'string') {
    const kind = decision === 'accept' ? 'once' : decision === 'acceptForSession' ? 'session' : decision === 'decline' ? 'decline' : decision === 'cancel' ? 'cancel' : undefined;
    if (kind) return { id: decision, kind, response: { decision } };
    return;
  }
  if (method !== command || !record(decision) || Object.keys(decision).length !== 1) return;
  const exec = decision.acceptWithExecpolicyAmendment;
  if (record(exec) && Object.keys(exec).length === 1 && prefix(exec.execpolicy_amendment)) {
    return { id: `rule:${index}`, kind: 'rule', detail: exec.execpolicy_amendment.join(' '),
      response: { decision: { acceptWithExecpolicyAmendment: { execpolicy_amendment: exec.execpolicy_amendment } } } };
  }
  const network = decision.applyNetworkPolicyAmendment;
  if (record(network) && Object.keys(network).length === 1 && networkRule(network.network_policy_amendment)) {
    const amendment = network.network_policy_amendment;
    return { id: `network:${index}`, kind: 'network', detail: amendment.host, networkAction: amendment.action,
      response: { decision: { applyNetworkPolicyAmendment: { network_policy_amendment: amendment } } } };
  }
}

export function approvalOptions(agent: AgentId, method: string, params: Record<string, any>): ApprovalOption[] | undefined {
  if (![command, file, permissions].includes(method)) return;
  // Other adapters currently implement these three responses. A Codex-shaped
  // request from another provider does not opt that adapter into native scopes.
  if (agent !== 'codex') return ['accept', 'decline', 'cancel'].map(decision => ({
    id: decision, kind: decision === 'accept' ? 'once' : decision as 'decline' | 'cancel',
    response: method === permissions ? { permissions: decision === 'accept' ? params.permissions : {}, scope: 'turn' } : { decision },
  }));
  if (method === permissions) {
    const granted = permissionGrant(params.permissions);
    return [
      ...(granted ? [
        { id: 'accept', kind: 'once' as const, response: { permissions: granted, scope: 'turn' } },
        { id: 'acceptForSession', kind: 'session' as const, response: { permissions: granted, scope: 'session' } },
      ] : []),
      { id: 'decline', kind: 'decline', response: { permissions: {}, scope: 'turn' } },
      { id: 'cancel', kind: 'cancel', response: { permissions: {}, scope: 'turn' } },
    ];
  }
  let decisions: unknown[];
  if (params.availableDecisions != null) {
    // The native list is ordered and authoritative, including an empty list.
    // Never insert an approval scope the runtime deliberately withheld.
    decisions = Array.isArray(params.availableDecisions) ? params.availableDecisions : [];
  } else if (method === file) decisions = ['accept', 'acceptForSession', 'decline', 'cancel'];
  else {
    decisions = ['accept'];
    if (record(params.networkApprovalContext)) {
      decisions.push('acceptForSession');
      const amendment = Array.isArray(params.proposedNetworkPolicyAmendments)
        ? params.proposedNetworkPolicyAmendments.find((rule: unknown) => networkRule(rule) && rule.action === 'allow') : undefined;
      if (amendment) decisions.push({ applyNetworkPolicyAmendment: { network_policy_amendment: amendment } });
    } else if (params.additionalPermissions == null && prefix(params.proposedExecpolicyAmendment)) {
      decisions.push({ acceptWithExecpolicyAmendment: { execpolicy_amendment: params.proposedExecpolicyAmendment } });
    }
    decisions.push('decline', 'cancel');
  }
  const options = decisions.map((decision, index) => nativeOption(decision, index, method)).filter((option): option is ApprovalOption => Boolean(option));
  return options.filter((option, index) => options.findIndex(other => other.id === option.id) === index);
}

export function approvalChoices(agent: AgentId, method: string, params: Record<string, any>): ApprovalChoice[] | undefined {
  return approvalOptions(agent, method, params)?.map(({ response: _, ...choice }) => choice);
}

export function approvalResponse(agent: AgentId, method: string, params: Record<string, any>, input: { choice?: string; decision?: string }): unknown {
  const id = input.choice ?? input.decision;
  // Legacy clients may keep their once/deny/cancel buttons. Scoped decisions
  // always use an offered choice id; client-supplied policy objects are ignored.
  if (typeof id !== 'string' || (input.choice !== undefined && input.decision !== undefined)
    || (input.choice === undefined && !['accept', 'decline', 'cancel'].includes(id))) throw new Error('Invalid approval decision.');
  const option = approvalOptions(agent, method, params)?.find(choice => choice.id === id);
  if (!option) throw new Error('Invalid approval decision.');
  return option.response;
}
