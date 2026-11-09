// Force the web-mobile build to fit the whole 1280x720 design inside any
// viewport (landscape, portrait iframe, phone). FIXED_WIDTH (policy 4) makes
// the world taller than the design height, which pushed the main menu off
// screen inside itch's embed frame.
const fs = require('fs');
const path = require('path');

const file = process.argv[2];
if (!file) {
  console.error('usage: node fix-resolution.js <settings.json>');
  process.exit(1);
}

const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
const screen = settings.screen || (settings.screen = {});
const design = screen.designResolution || (screen.designResolution = {});

const before = { policy: design.policy, exactFit: screen.exactFitScreen };

// 2 = SHOW_ALL: letterbox but never crop, so the full design is always visible.
design.policy = 2;
screen.exactFitScreen = false;
if (design.width == null) design.width = 1280;
if (design.height == null) design.height = 720;

fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n', 'utf8');
console.log('resolution patched:', JSON.stringify(before), '->',
  JSON.stringify({ policy: design.policy, exactFit: screen.exactFitScreen }));
