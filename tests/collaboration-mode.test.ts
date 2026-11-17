import test from 'node:test';
import assert from 'node:assert/strict';
import { collaborationPayload, collaborationPresets, validateCollaborationMode } from '../src/server/collaboration-mode.ts';

test('native collaboration catalog and turn settings preserve the host protocol', () => {
  assert.deepEqual(collaborationPresets([{name:'Plan',mode:'plan',model:'catalog-model',reasoning_effort:'high'},{mode:'unknown'},{mode:'plan'},{name:'Default',mode:'default',model:null,reasoning_effort:null}]), [{name:'Plan',mode:'plan',model:'catalog-model',reasoningEffort:'high'},{name:'Default',mode:'default',model:null,reasoningEffort:null}]);
  assert.deepEqual(collaborationPayload(undefined,null,null),{});
  assert.deepEqual(collaborationPayload('plan','chosen-model','medium'),{collaborationMode:{mode:'plan',settings:{model:'chosen-model',reasoning_effort:'medium',developer_instructions:null}}});
  assert.deepEqual(collaborationPayload('default','chosen-model',null),{collaborationMode:{mode:'default',settings:{model:'chosen-model',reasoning_effort:null,developer_instructions:null}}});
  assert.throws(()=>collaborationPayload('plan',null,'high'),/Choose a model/);
});

test('Plan only opts in when Codex advertises it and leaves older tasks unchanged',()=>{
  const runtime={connected:true,authenticated:true,account:null,error:null,models:[]};
  assert.equal(validateCollaborationMode(undefined,runtime,'claude',true),undefined);
  assert.throws(()=>validateCollaborationMode('plan',runtime,'codex',false),/not available/);
  const supported={...runtime,collaborationModes:collaborationPresets([{mode:'plan'}])};
  assert.equal(validateCollaborationMode('plan',supported,'codex',false),'plan');
  assert.equal(validateCollaborationMode('default',supported,'codex',false),'default');
  assert.throws(()=>validateCollaborationMode('plan',supported,'claude',false),/not available/);
  assert.throws(()=>validateCollaborationMode('plan',supported,'codex',true),/not available/);
  assert.throws(()=>validateCollaborationMode('execute',supported,'codex',false),/Invalid/);
});
