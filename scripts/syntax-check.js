const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const ignored = new Set(['node_modules', '.git', 'session', 'temp', 'tmp']);
const files = [];

function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!ignored.has(entry.name)) walk(path.join(dir, entry.name));
            continue;
        }
        if (entry.isFile() && entry.name.endsWith('.js')) {
            files.push(path.join(dir, entry.name));
        }
    }
}

walk(root);

let failed = 0;
for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
        failed++;
        console.error(`FAILED ${path.relative(root, file)}`);
        if (result.stderr) console.error(result.stderr.trim());
    }
}

console.log(`Checked ${files.length} JavaScript file(s). ${failed ? `${failed} failed.` : 'All syntax checks passed.'}`);
process.exit(failed ? 1 : 0);
