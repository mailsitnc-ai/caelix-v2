'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createSessionStore(dir) {
  const d = path.join(dir, 'sessions'); fs.mkdirSync(d, { recursive: true });
  const file = (id) => path.join(d, id + '.json');
  return {
    newId: () => crypto.randomUUID(),
    save(s) { const tmp = file(s.id) + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(s)); fs.renameSync(tmp, file(s.id)); },
    load(id) { try { return JSON.parse(fs.readFileSync(file(id), 'utf8')); } catch (_) { return null; } },
    remove(id) { try { fs.unlinkSync(file(id)); } catch (_) {} },
    list() {
      const out = [];
      for (const f of fs.readdirSync(d)) {
        if (!f.endsWith('.json')) continue;
        try { const s = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')); out.push({ id: s.id, kind: s.kind || 'code', title: s.title, cwd: s.cwd, updated: s.updated, created: s.created, archived: !!s.archived, pinned: !!s.pinned, provider: s.provider, model: s.model, running: false, changes: s.changes || 0 }); } catch (_) {}
      }
      return out.sort((a, b) => b.updated - a.updated);
    },
  };
}
module.exports = { createSessionStore };
