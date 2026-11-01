// The Empire of Fex starts from zero. The first time this version starts, the data files of the old coin economy are set
// aside (MOVED to data/legacy-economy, never deleted, so nothing can be lost by mistake). A marker file says it is done, so
// it happens only once. It must run before anything opens the data folder.
const fs = require('fs');
const path = require('path');

const OLD = ['economy', 'market', 'throne', 'lottery', 'quests', 'predict', 'governor', 'community', 'report'];

function run(dir) {
  try {
    const marker = path.join(dir, '.empire-fresh');
    if (fs.existsSync(marker)) return 0;
    let n = 0;
    const keep = path.join(dir, 'legacy-economy');
    for (const name of OLD) {
      for (const f of [`${name}.json`, `${name}.json.bak`, `${name}.json.tmp`]) {
        const p = path.join(dir, f);
        if (fs.existsSync(p)) {
          fs.mkdirSync(keep, { recursive: true });
          fs.renameSync(p, path.join(keep, f));
          n += 1;
        }
      }
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(marker, String(Date.now()));
    if (n) console.log(`🧹 The old economy was set aside in data/legacy-economy (${n} files, nothing deleted). The Empire of Fex starts from zero.`);
    return n;
  } catch (err) {
    console.error(`Could not set the old economy aside: ${err.message}`);
    return 0;
  }
}

module.exports = { run, OLD };
