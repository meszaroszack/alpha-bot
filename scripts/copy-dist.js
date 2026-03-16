const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'frontend', 'dist');
const dest = path.join(root, 'backend', 'public');

if (!fs.existsSync(src)) {
  console.error('Frontend build not found. Run: cd frontend && npm run build');
  process.exit(1);
}
fs.mkdirSync(dest, { recursive: true });
fs.cpSync(src, dest, { recursive: true });
console.log('Copied frontend/dist → backend/public');
