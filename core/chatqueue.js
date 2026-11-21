// One line of waiting messages per chat: the messages of ONE chat are handled in order, different chats never wait for each other.
// A line has a limit. In a flooded chat the messages used to pile up without end (memory grows, and the answers come later and
// later), so when a line is longer than the limit the OLDEST waiting messages are dropped and the newest are kept.
const MAX_WAITING = 100;

function createQueues(max = MAX_WAITING) {
  const chats = new Map(); // chat -> { items: [task], running }

  async function pump(chat, state) {
    state.running = true;
    while (state.items.length) {
      const task = state.items.shift();
      try {
        await task();
      } catch (err) {
        // a task handles its own errors; one failing task never stops the line
      }
    }
    state.running = false;
    if (chats.get(chat) === state) chats.delete(chat);
  }

  // adds a task to the chat's line; returns how many old waiting tasks were dropped to stay under the limit
  function enqueue(chat, task) {
    let state = chats.get(chat);
    if (!state) {
      state = { items: [], running: false };
      chats.set(chat, state);
    }
    state.items.push(task);
    let dropped = 0;
    while (state.items.length > max) {
      state.items.shift();
      dropped += 1;
    }
    if (!state.running) pump(chat, state);
    return dropped;
  }

  const waiting = (chat) => (chats.get(chat) ? chats.get(chat).items.length : 0);
  return { enqueue, waiting, size: () => chats.size };
}

module.exports = { createQueues, MAX_WAITING };
