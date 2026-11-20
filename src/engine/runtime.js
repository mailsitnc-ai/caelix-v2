'use strict';
function newRuntime({ provider, model, cwd, mode, messages, checkpoints, kind }) {
  return {
    provider, model, kind: kind || 'code', team: false, ctxLimit: 2000000, messages: messages || [], checkpoints: checkpoints || [], turn: 0,
    usage: { in: 0, out: 0 }, turnSnap: new Map(), baseSnap: new Map(), mcp: null,
    st: { cwd, mode: mode || 'default', readFiles: new Set(), todos: [] },
  };
}
module.exports = { newRuntime };
