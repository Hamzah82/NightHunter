const fs = require('fs');
const path = require('path');

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const dirs = ['temp', 'tmp'];
let removed = 0;

for (const dir of dirs) {
    const target = path.join(process.cwd(), dir);
    if (!fs.existsSync(target)) continue;

    for (const name of fs.readdirSync(target)) {
        const filePath = path.join(target, name);
        try {
            const stat = fs.statSync(filePath);
            if (!stat.isFile() || Date.now() - stat.mtimeMs < MAX_AGE_MS) continue;
            fs.unlinkSync(filePath);
            removed++;
        } catch (error) {
            console.error(`Failed to remove ${filePath}:`, error.message);
        }
    }
}

console.log(`Cleanup finished. Removed ${removed} file(s) older than 24 hours.`);
