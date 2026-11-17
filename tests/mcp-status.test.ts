import test from 'node:test';
import assert from 'node:assert/strict';
import { mcpStatus } from '../src/server/mcp-status.ts';

test('MCP status follows pagination and config aliases without exposing configuration or tools', async () => {
  const calls: [string, any][] = [];
  const servers = await mcpStatus({ ready: true, async request(method, params) {
    calls.push([method, params]);
    if (method === 'config/read') return { config: { mcp_servers: { alias: { name: 'research', enabled: false, env: { TOKEN: 'secret' }, command: 'private-command' } } } };
    return (params as any).cursor === null
      ? { data: [{ name: 'research', authStatus: 'bearerToken', tools: { private: {} } }], nextCursor: 'next' }
      : { data: [{ name: 'library', authStatus: 'oAuth', url: 'https://private.invalid' }, { name: 'plain', authStatus: 'unknown' }], nextCursor: null };
  } });
  assert.deepEqual(servers, [
    { name: 'library', enabled: true, authStatus: 'oAuth' },
    { name: 'plain', enabled: true, authStatus: 'unsupported' },
    { name: 'research', enabled: false, authStatus: 'bearerToken' },
  ]);
  assert.deepEqual(calls.slice(1), [
    ['mcpServerStatus/list', { cursor: null, limit: 100, detail: 'toolsAndAuthOnly' }],
    ['mcpServerStatus/list', { cursor: 'next', limit: 100, detail: 'toolsAndAuthOnly' }],
  ]);
  assert.doesNotMatch(JSON.stringify(servers), /secret|private/);
});

test('MCP status does not start a disconnected runtime or hide protocol errors as an empty list', async () => {
  await assert.rejects(mcpStatus({ ready: false, async request() { assert.fail('must not start a runtime'); } }), /not connected/);
  await assert.rejects(mcpStatus({ ready: true, async request(method) { return method === 'config/read' ? {} : {}; } }), /Unable to load/);
  await assert.rejects(mcpStatus({ ready: true, async request(method) { return method === 'config/read' ? {} : { data: [], nextCursor: 'repeated' }; } }), /Unable to load/);
});

test('MCP canonical config names and native disabled status take priority over aliases and defaults', async () => {
  const statuses = await mcpStatus({ ready: true, async request(method) {
    return method === 'config/read'
      ? { config: { mcp_servers: { canonical: { enabled: false }, alias: { name: 'canonical', enabled: true } } } }
      : { data: [{ name: 'canonical', authStatus: 'notLoggedIn' }, { name: 'plugin', runtimeStatus: 'disabled' }] };
  } });
  assert.deepEqual(statuses.map(server => [server.name, server.enabled]), [['canonical', false], ['plugin', false]]);
});
