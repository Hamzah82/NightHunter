const fs = require('fs');
const path = require('path');

const sessionPath = path.join(process.cwd(), 'session');

if (!fs.existsSync(sessionPath)) {
    console.log('No session directory found.');
    process.exit(0);
}

fs.rmSync(sessionPath, { recursive: true, force: true });
console.log('Session directory removed. Restart the bot and authenticate again.');
