import fs from 'node:fs';
const file = 'D:/DeepSeek/resources/app.asar';
const fd = fs.openSync(file, 'r');
const head = Buffer.alloc(16);
fs.readSync(fd, head, 0, 16, 0);
const headerSize = head.readUInt32LE(4);
const jsonLen = headerSize - 8;
const hbuf = Buffer.alloc(jsonLen);
fs.readSync(fd, hbuf, 0, jsonLen, 16);
const header = JSON.parse(hbuf.toString('utf8'));
const base = 16 + jsonLen;
const hits = [];
function walk(node, path, depth) {
  for (const [k, v] of Object.entries(node.files || {})) {
    const p = path + '/' + k;
    if (v.files) { if (depth < 5) walk(v, p, depth + 1); }
    else if (k === 'package.json' && (depth <= 2 || /node_modules\/@deepseek-ai\/dsh$/.test(p))) hits.push({ path: p, size: v.size, offset: parseInt(v.offset, 10) });
  }
}
walk(header, '', 0);
for (const h of hits) {
  const buf = Buffer.alloc(h.size);
  fs.readSync(fd, buf, 0, h.size, base + h.offset);
  let pkg; try { pkg = JSON.parse(buf.toString('utf8')); } catch { continue; }
  console.log(h.path + ' => ' + pkg.name + '@' + pkg.version + (pkg.dependencies && pkg.dependencies['@openai/codex'] ? ' codex=' + pkg.dependencies['@openai/codex'] : ''));
}
console.log('TOTAL package.json scanned: ' + hits.length);
