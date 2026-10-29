// The Empire of Fex starts from zero. The first time this version starts, the data files of the old coin economy are deleted
// (a marker file says it is done, so it happens only once). It must run before anything opens the data folder.
const fs = require('fs');
const path = require('path');

const OLD = ['economy', 'market', 'throne', 'lottery', 'quests', 'predict', 'governor', 'community', 'report'];

function run(dir) {
  try {
    const marker = path.join(dir, '.empire-fresh');
    if (fs.existsSync(marker)) return 0;
    let n = 0;
    for (const name of OLD) {
      for (const f of [`${name}.json`, `${name}.json.bak`, `${name}.json.tmp`]) {
        const p = path.join(dir, f);
        if (fs.existsSync(p)) {
          fs.rmSync(p, { force: true });
          n += 1;
        }
      }
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(marker, String(Date.now()));
    if (n) console.log(`🧹 The old economy was removed (${n} files). The Empire of Fex starts from zero.`);
    return n;
  } catch (err) {
    console.error(`Could not remove the old economy: ${err.message}`);
    return 0;
  }
}

module.exports = { run, OLD };
