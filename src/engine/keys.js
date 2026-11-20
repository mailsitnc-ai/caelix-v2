'use strict';
// Encrypted key store. Keys live outside the project (userData) and are encrypted with the OS keychain via Electron safeStorage.
// Plaintext is never written to disk: if encryption is unavailable, saving is refused.
const fs = require('fs');
const path = require('path');

function createKeyStore(dir, safeStorage) {
  const file = path.join(dir, 'keys.enc.json');
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return {}; } };
  const write = (o) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(o), { mode: 0o600 }); };
  const mask = (k) => (k ? '••••••••' + k.slice(-4) : '');
  return {
    file,
    available: () => safeStorage.isEncryptionAvailable(),
    set(id, key) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is unavailable on this computer; key not saved.');
      const o = read(); o[id] = safeStorage.encryptString(key.trim()).toString('base64'); write(o);
    },
    get(id) { const o = read(); if (!o[id]) return ''; try { return safeStorage.decryptString(Buffer.from(o[id], 'base64')); } catch (_) { return ''; } },
    remove(id) { const o = read(); delete o[id]; write(o); },
    has: (id) => !!read()[id],
    masked(id) { return mask(this.get(id)); },
    ids: () => Object.keys(read()),
  };
}
module.exports = { createKeyStore };
