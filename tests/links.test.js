/* 文档链接检查：校验相对路径存在性 + 锚点是否匹配标题 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 从 markdown 标题生成 GitHub 风格的锚点 */
function anchorsOf(file) {
  const text = fs.readFileSync(file, 'utf8');
  const out = new Set();
  for (const m of text.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)) {
    out.add(m[1].toLowerCase()
      .replace(/[^\w\s\u4e00-\u9fff-]/g, '')  // 去掉标点，保留中日韩
      .trim()
      .replace(/\s+/g, '-'));
  }
  return out;
}

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'models' || e.name.startsWith('.')) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.md')) files.push(p);
  }
})(ROOT);

let total = 0, bad = 0;
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  const rel = path.relative(ROOT, f);
  const problems = [];

  for (const m of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const raw = m[1].trim();
    if (/^https?:\/\//.test(raw) || raw.startsWith('mailto:')) continue;
    total++;

    const [filePart, anchor] = raw.split('#');
    if (!filePart) {
      // 纯锚点，指向本文件
      if (anchor && !anchorsOf(f).has(anchor)) problems.push(raw + '  (本文件无此锚点)');
      continue;
    }
    const target = path.resolve(path.dirname(f), filePart);
    if (!fs.existsSync(target)) { problems.push(raw + '  (文件不存在)'); continue; }
    if (anchor && target.endsWith('.md') && !anchorsOf(target).has(anchor)) {
      problems.push(raw + '  (锚点不存在，实际标题: ' + [...anchorsOf(target)].slice(0, 4).join(' / ') + ' ...)');
    }
  }

  if (problems.length) {
    bad += problems.length;
    console.log('✗ ' + rel);
    problems.forEach((p) => console.log('    ' + p));
  }
}

console.log('\n检查 ' + files.length + ' 个 markdown 文件，' + total + ' 个相对链接');
console.log(bad === 0 ? '✅ 全部有效' : '❌ ' + bad + ' 个失效');
process.exitCode = bad ? 1 : 0;
