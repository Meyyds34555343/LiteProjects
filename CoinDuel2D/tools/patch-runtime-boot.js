const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '../build/web-mobile-runtime-fix/assets/main/index.js');
let s = fs.readFileSync(file, 'utf8');
let n = 0;

function rep(from, to, label) {
  if (!s.includes(from)) {
    console.log('MISSING', label);
    return;
  }
  const parts = s.split(from);
  s = parts.join(to);
  console.log('patched', label, 'x' + (parts.length - 1));
  n += parts.length - 1;
}

// Gate beginner tutorial to campaign Level mode only
rep(
  'this._levelIndex>=0&&this.tutorialManager){this.tutorialManager.gameLogic=this.gameLogic',
  'i.mode===de.Level&&this._levelIndex>=0&&this.tutorialManager){this.tutorialManager.skipTutorial(),this.tutorialManager.gameLogic=this.gameLogic',
  'tutorial-gate'
);

// Ladder never loads Scratch; activeMod only when ?mod= / ?modUrl=
rep(
  '(null!=(i=a.gameLogic.getComponent(A))?i:a.gameLogic.addComponent(A)).sync((function(){var e=G.getCurrent();if(!e)try{var i,n,t=null!=(i=null==(n=h.localStorage)?void 0:n.getItem("CoinDuel:activeMod"))?i:"undefined"!=typeof localStorage?localStorage.getItem("CoinDuel:activeMod"):null;if(t){var o=JSON.parse(t);null!=o&&o.level&&Array.isArray(o.level.coins)&&(G.setScratchLevel(o.level),e=o.level)}}catch(e){}e?(a._levelFiles=G.getLevelFiles(),a._levelIndex=G.getLevelIndex(),a._initFromLevel(e)):(G.clear(),a.startNewRound())}))',
  '(null!=(i=a.gameLogic.getComponent(A))?i:a.gameLogic.addComponent(A)).sync((function(){if(i.mode===de.Ladder){G.clear();a.tutorialManager&&a.tutorialManager.skipTutorial();a.startNewRound();return}var e=G.getCurrent();var q=typeof location!=="undefined"?location.search||"":"";var explicit=q.indexOf("mod=")>=0||q.indexOf("modUrl=")>=0;if(!e&&explicit)try{var i2,n,t=null!=(i2=null==(n=h.localStorage)?void 0:n.getItem("CoinDuel:activeMod"))?i2:"undefined"!=typeof localStorage?localStorage.getItem("CoinDuel:activeMod"):null;if(t){var o=JSON.parse(t);null!=o&&o.level&&Array.isArray(o.level.coins)&&(G.setScratchLevel(o.level),e=o.level)}}catch(e){}e?(a._levelFiles=G.getLevelFiles(),a._levelIndex=G.getLevelIndex(),a._initFromLevel(e)):(G.clear(),a.startNewRound())}))',
  'boot-ladder-scratch'
);

// Win panel: Ladder always enables next; scratch disables; campaign uses has-next
rep(
  'n.show(t,a.gameLogic.score,e);var o=a._levelIndex>=0&&a._levelIndex>=a._levelFiles.length-1;n.setNextEnabled(!o)',
  'n.show(t,a.gameLogic.score,e);i.mode===de.Ladder?n.setNextEnabled(!0):G.isScratchPack()?n.setNextEnabled(!1):n.setNextEnabled(a._levelIndex>=0&&a._levelIndex<a._levelFiles.length-1)',
  'next-enabled'
);

// MainScene ladder: clear LevelManager fully + clear on main load
rep(
  'M.mode=h.Ladder,b.setCurrent(null),d.loadScene("game")',
  'M.mode=h.Ladder,b.clear(),d.loadScene("game")',
  'main-ladder-clear'
);

rep(
  'o.onLoad=function(){if(this.btnLevels.node.on(s.EventType.CLICK,(function(){M.mode=h.Level,d.loadScene("levels")}),this)',
  'o.onLoad=function(){if(M.mode=h.Level,b.clear(),this.btnLevels.node.on(s.EventType.CLICK,(function(){M.mode=h.Level;try{var q=typeof location!=="undefined"?new URLSearchParams(location.search||""):null;if(q&&(q.get("mod")||q.get("modUrl"))){var raw=localStorage.getItem("CoinDuel:activeMod");if(raw){var mod=JSON.parse(raw);if(mod&&mod.level&&Array.isArray(mod.level.coins))return b.setScratchLevel(mod.level),void d.loadScene("game")}}}catch(e){}d.loadScene("levels")}),this)',
  'main-start-clear-modplay'
);

fs.writeFileSync(file, s);
console.log('wrote', file, 'patches', n);
