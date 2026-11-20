'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a).then((r) => { if (r && r.__error) throw new Error(r.__error); return r; });
const on = (ch, cb) => { const f = (_e, p) => cb(p); ipcRenderer.on(ch, f); return () => ipcRenderer.removeListener(ch, f); };
contextBridge.exposeInMainWorld('caelix', {
  init: inv('app:init'), setKey: inv('keys:set'), removeKey: inv('keys:remove'), setBase: inv('keys:base'), models: inv('models:list'), probe: inv('models:probe'), archive: inv('models:archive'), unarchive: inv('models:unarchive'), onProbe: (f) => ipcRenderer.on('probe:progress', (_e, d) => f(d)), setLast: inv('last:set'),
  newSession: inv('session:new'), openSession: inv('session:open'), listSessions: inv('session:list'), setSession: inv('session:set'), deleteSession: inv('session:delete'), forkSession: inv('session:fork'),
  send: inv('chat:send'), stop: inv('chat:stop'), answer: inv('chat:answer'), compact: inv('chat:compact'), rewind: inv('chat:rewind'), clear: inv('chat:clear'), side: inv('chat:side'), exportChat: inv('chat:export'),
  addNote: inv('memory:add'), showMemory: inv('memory:show'), initProject: inv('init:project'),
  diff: inv('diff:get'), listDir: inv('files:list'), readFile: inv('files:read'), writeFile: inv('files:write'), mentions: inv('files:mentions'),
  pickFolder: inv('pick:folder'), pickFiles: inv('pick:files'), gitBranch: inv('git:branch'), reveal: inv('shell:reveal'), openUrl: inv('shell:open'),
  getSettings: inv('settings:get'), setSettings: inv('settings:set'), skills: inv('skills:list'),
  resetChat: inv('chat:reset'), mcpList: inv('mcp:list'), mcpAdd: inv('mcp:add'), mcpRemove: inv('mcp:remove'), mcpToggle: inv('mcp:toggle'), mcpImport: inv('mcp:import'), hooksList: inv('hooks:list'), hooksAdd: inv('hooks:add'), hooksRemove: inv('hooks:remove'), hooksToggle: inv('hooks:toggle'), memoryInfo: inv('memory:info'), agents: inv('agents:list'), favs: inv('fav:get'), toggleFav: inv('fav:toggle'), openDocs: inv('docs:open'), systemPrompt: inv('prompt:system'),
  termRun: inv('term:run'), termKill: inv('term:kill'), timing: inv('timing'),
  uiReady: () => ipcRenderer.send('ui-ready'),
  onEvent: (cb) => on('evt', cb), onTerm: (cb) => on('term', cb), onSessionsChanged: (cb) => on('sessions-changed', cb), onTitle: (cb) => on('title', cb),
});
