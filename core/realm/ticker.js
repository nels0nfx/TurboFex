// Features that must do something from time to time (news, elections, events...) register here. The scheduler calls run() every few seconds
// and each job decides for itself if it is due. A job gets "post(group, content)" to write in a group.
const jobs = new Map();
let busy = false;

const register = (name, fn) => jobs.set(name, fn);

async function run(post) {
  if (busy) return;
  busy = true;
  try {
    for (const [name, fn] of jobs) {
      try {
        await fn(post, Date.now());
      } catch (err) {
        console.error(`Realm job "${name}" failed: ${err.message}`);
      }
    }
  } finally {
    busy = false;
  }
}

const names = () => [...jobs.keys()];

module.exports = { register, run, names };
