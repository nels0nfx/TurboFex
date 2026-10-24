// A small saved JSON file for a feature (levels, notes, birthdays, stats...). Changes are kept in memory and written to
// disk a moment later, and always when the bot stops or restarts.
const fs = require('fs');
const path = require('path');
const { DATA } = require('./paths');
const { onFlush } = require('./flush');

function open(name, initial) {
  const file = path.join(DATA, `${name}.json`);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    data = typeof initial === 'function' ? initial() : JSON.parse(JSON.stringify(initial));
  }
  let dirty = false;
  let timer = null;

  const write = () => {
    if (!dirty) return;
    try {
      fs.mkdirSync(DATA, { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, file); // never a half-written file
      dirty = false;
    } catch (err) {
      console.error(`Could not save ${name}:`, err.message);
    }
  };
  onFlush(write);
  process.on('exit', write);

  return {
    get data() {
      return data;
    },
    touch() {
      dirty = true;
      if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          write();
        }, 2000);
        if (timer.unref) timer.unref();
      }
    },
    flush: write,
  };
}

module.exports = { open };
