import type { McpServerStatus } from '../shared.ts';

interface Runtime { ready: boolean; request(method: string, params: unknown, timeout?: number): Promise<any> }

// Match the extension's status menu without exposing MCP commands, environment
// variables, URLs, tokens or tool schemas to the browser.
export async function mcpStatus(runtime: Runtime): Promise<McpServerStatus[]> {
  if (!runtime.ready) throw new Error('Codex is not connected.');
  const configuration = await runtime.request('config/read', { includeLayers: false }, 20000);
  const enabled = new Map<string, boolean>(), aliases = new Map<string, boolean>();
  for (const [key, value] of Object.entries(configuration?.config?.mcp_servers || {})) {
    if (!value || typeof value !== 'object') continue;
    const server = value as { name?: unknown; enabled?: unknown };
    enabled.set(key, server.enabled !== false);
    if (typeof server.name === 'string') aliases.set(server.name, server.enabled !== false);
  }
  const servers = new Map<string, McpServerStatus>(), cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await runtime.request('mcpServerStatus/list', { cursor, limit: 100, detail: 'toolsAndAuthOnly' }, 20000);
    if (!Array.isArray(page?.data)) throw new Error('Unable to load MCP status');
    for (const value of page.data) {
      if (!value || typeof value.name !== 'string') throw new Error('Unable to load MCP status');
      const authStatus = ['notLoggedIn', 'bearerToken', 'oAuth'].includes(value.authStatus) ? value.authStatus : 'unsupported';
      servers.set(value.name, { name: value.name, enabled: value.runtimeStatus !== 'disabled' && (enabled.get(value.name) ?? aliases.get(value.name) ?? true), authStatus });
    }
    cursor = page.nextCursor ?? null;
    if (cursor !== null) {
      if (typeof cursor !== 'string' || cursors.has(cursor)) throw new Error('Unable to load MCP status');
      cursors.add(cursor);
    }
  } while (cursor !== null);
  return [...servers.values()].sort((a, b) => a.name.localeCompare(b.name));
}
