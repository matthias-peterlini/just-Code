// Cross-platform smoke test for the agent tools (run after `npm run build`).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TOOLS, shellInfo } from '../dist/tools/index.js';

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'jc-'));
const asked = [];
const ctx = { cwd, agent: 'test', requestPermission: async (r) => (asked.push(r.tool), true) };
const run = (name, args) => TOOLS[name].run(args, ctx);

console.log('platform', process.platform, 'shell', shellInfo().name);

assert.match(await run('write_file', { path: 'src/a/b.txt', content: 'hello\nworld\n' }), /Wrote/);
assert.match(await run('read_file', { path: 'src/a/b.txt' }), /1 {2}hello/);
assert.equal((await run('list_files', {})).trim(), 'src/a/b.txt', 'paths use forward slashes');
assert.equal((await run('list_files', { glob: 'src/**/*.txt' })).trim(), 'src/a/b.txt');
assert.match(await run('search', { pattern: 'wor' }), /src\/a\/b\.txt:2: world/);

// CRLF files are edited correctly when the model sends \n
fs.writeFileSync(path.join(cwd, 'crlf.txt'), 'one\r\ntwo\r\nthree\r\n');
assert.match(await run('edit_file', { path: 'crlf.txt', old_string: 'one\ntwo', new_string: 'uno\ndue' }), /Edited/);
assert.equal(fs.readFileSync(path.join(cwd, 'crlf.txt'), 'utf8'), 'uno\r\ndue\r\nthree\r\n');

// sandbox
await assert.rejects(() => run('read_file', { path: '../outside.txt' }), /outside the workspace/);

// shell (same syntax works in cmd.exe and POSIX shells)
const sh = await run('run_shell', { command: 'echo just-code && node -e "process.exit(3)"' });
assert.match(sh, /just-code/);
assert.match(sh, /^exit 3/);
const t0 = Date.now();
const slow = await run('run_shell', { command: 'node -e "setTimeout(()=>{}, 20000)"', timeout_sec: 1 });
assert.match(slow, /timed out/);
assert.ok(Date.now() - t0 < 10000, 'timeout kills the process');

assert.deepEqual(asked, ['write_file', 'edit_file', 'run_shell', 'run_shell']);
fs.rmSync(cwd, { recursive: true, force: true });
console.log('smoke ok');
