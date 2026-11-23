#!/usr/bin/env node
'use strict';
// Gives CAELIX.exe its own icon and name (instead of Electron's) by editing the exe's resources. Pure JavaScript,
// run on any OS. Needs the "resedit" package on NODE_PATH:  npm install --prefix <tools dir> resedit
const fs = require('fs');
const R = require('resedit');
const [exePath, icoPath, version] = process.argv.slice(2);
if (!exePath || !icoPath) { console.error('usage: set-exe-icon.js <CAELIX.exe> <icon.ico> [version]'); process.exit(1); }
const exe = R.NtExecutable.from(fs.readFileSync(exePath));
const res = R.NtExecutableResource.from(exe);
const ico = R.Data.IconFile.from(fs.readFileSync(icoPath));
const group = res.entries.find((e) => e.type === 14);
if (!group) throw new Error('the exe has no icon group');
R.Resource.IconGroupEntry.replaceIconsForResource(res.entries, group.id, group.lang, ico.icons.map((i) => i.data));
const vi = R.Resource.VersionInfo.fromEntries(res.entries)[0];
for (const l of vi.getAllLanguagesForStringValues()) {
  vi.setStringValues(l, { CompanyName: 'CAELIX', FileDescription: 'CAELIX', InternalName: 'CAELIX.exe', OriginalFilename: 'CAELIX.exe', ProductName: 'CAELIX', LegalCopyright: 'CAELIX', ...(version ? { FileVersion: version, ProductVersion: version } : {}) });
}
vi.outputToResourceEntries(res.entries);
res.outputResource(exe);
fs.writeFileSync(exePath, Buffer.from(exe.generate()));
console.log('icon and version info set');
