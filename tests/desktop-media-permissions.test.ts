import test from 'node:test';
import assert from 'node:assert/strict';
import { microphoneRequest, workspacePermissionCheck } from '../desktop/media-permissions.ts';

const origin = 'http://127.0.0.1:41234';
const frame = { isMainFrame: true, requestingUrl: origin + '/?paper=example', securityOrigin: origin };
test('desktop microphone requires the current workspace main frame and audio only', () => {
  assert.equal(microphoneRequest(true, origin, 'media', { ...frame, mediaTypes: ['audio'] }), true);
  assert.equal(workspacePermissionCheck(true, origin, 'media', origin, { ...frame, mediaType: 'audio' }), true);
  for (const details of [{ ...frame, mediaTypes: ['video'] }, { ...frame, mediaTypes: ['audio', 'video'] }, { ...frame, mediaTypes: [] }, frame,
    { ...frame, mediaTypes: ['audio'], isMainFrame: false }, { ...frame, mediaTypes: ['audio'], requestingUrl: 'https://example.com' },
    { ...frame, mediaTypes: ['audio'], requestingUrl: 'http://127.0.0.1:41235' }, { ...frame, mediaTypes: ['audio'], securityOrigin: 'https://example.com' }])
    assert.equal(microphoneRequest(true, origin, 'media', details), false);
  assert.equal(microphoneRequest(false, origin, 'media', { ...frame, mediaTypes: ['audio'] }), false);
  for (const permission of ['display-capture', 'notifications', 'clipboard-read', 'unknown']) assert.equal(microphoneRequest(true, origin, permission, { ...frame, mediaTypes: ['audio'] }), false);
  for (const mediaType of ['video', 'unknown', undefined]) assert.equal(workspacePermissionCheck(true, origin, 'media', origin, { ...frame, mediaType }), false);
  assert.equal(workspacePermissionCheck(true, origin, 'media', origin + 'evil', { ...frame, mediaType: 'audio' }), false);
  assert.equal(workspacePermissionCheck(true, '', 'media', origin, { ...frame, mediaType: 'audio' }), false);
  assert.equal(workspacePermissionCheck(true, origin, 'media', origin, { requestingUrl: origin, mediaType: 'audio' }), false);
  assert.equal(workspacePermissionCheck(true, 'http://127.0.0.1:41235', 'media', origin, { ...frame, mediaType: 'audio' }), false);
  assert.equal(workspacePermissionCheck(true, origin, 'media', origin, { ...frame, securityOrigin: 'https://example.com', mediaType: 'audio' }), false);
});
test('same-origin review copying survives without enabling reads or external frames', () => {
  assert.equal(workspacePermissionCheck(true, origin, 'clipboard-sanitized-write', origin, { ...frame, isMainFrame: false }), true);
  assert.equal(workspacePermissionCheck(true, origin, 'clipboard-read', origin, frame), false);
  assert.equal(workspacePermissionCheck(false, origin, 'clipboard-sanitized-write', origin, frame), false);
  assert.equal(workspacePermissionCheck(true, origin, 'clipboard-sanitized-write', 'https://example.com', frame), false);
  assert.equal(workspacePermissionCheck(true, origin, 'clipboard-sanitized-write', origin, { ...frame, requestingUrl: 'https://example.com' }), false);
});
