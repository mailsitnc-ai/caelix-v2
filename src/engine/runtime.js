'use strict';
function newRuntime({ provider, model, cwd, mode, messages, checkpoints }) {
  return {
    provider, model, ctxLimit: 128000, messages: messages || [], checkpoints: checkpoints || [], turn: 0,
    usage: { in: 0, out: 0 }, turnSnap: new Map(), baseSnap: new Map(), mcp: null,
    st: { cwd, mode: mode || 'default', readFiles: new Set(), todos: [] },
  };
}
module.exports = { newRuntime };
