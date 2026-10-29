// Personal notes and a to-do list. They are private: only used in a private chat with the bot.
const jsonstore = require('../core/jsonstore');

const js = jsonstore.open('notes', {}); // { person: { notes: [{ t, at }], todos: [{ t, done }] } }
const MAX = 50;
const NOTE_MAX = 4000; // characters in one note
const book = (id) => js.data[id] || (js.data[id] = { notes: [], todos: [] });
const need = (ctx) => (ctx.isGroup ? ctx.reply(`🔒 Your ${ctx.cmdName === 'todo' ? 'to-do list' : 'notes'} are private. Use this command in a private chat with me.`) : null);
const num = (s) => parseInt(s, 10);

module.exports = [
  {
    name: 'note',
    aliases: ['notes'],
    category: 'tools',
    needs: [],
    weight: 'light',
    description: 'Your private notes (in a private chat): note add <text>, note, note get 2, note del 2, note clear',
    async run(ctx) {
      const blocked = need(ctx);
      if (blocked) return blocked;
      const { args, rest, reply, prefix, myIds } = ctx;
      const b = book(myIds[0]);
      const a = (args[0] || 'list').toLowerCase();
      const body = rest.slice(args[0] ? args[0].length : 0).trim();

      if (a === 'add' || a === 'save') {
        if (!body) return reply(`Write the note after add.\nExample: ${prefix}note add buy bread`);
        if (body.length > NOTE_MAX) return reply(`⚠️ A note can be up to ${NOTE_MAX} characters (yours has ${body.length}).`);
        if (b.notes.length >= MAX) return reply(`⚠️ You have ${MAX} notes already. Delete some with ${prefix}note del <number>.`);
        b.notes.push({ t: body, at: Date.now() });
        js.touch();
        return reply(`✅ *Note ${b.notes.length} saved.*`);
      }
      if (a === 'get' || a === 'show') {
        const n = b.notes[num(body) - 1];
        return reply(n ? `*Note ${num(body)}*\n\n${n.t}` : `⚠️ There is no note ${body || ''}. See ${prefix}note.`);
      }
      if (a === 'del' || a === 'delete' || a === 'remove') {
        const i = num(body) - 1;
        if (!b.notes[i]) return reply(`⚠️ There is no note ${body || ''}. See ${prefix}note.`);
        b.notes.splice(i, 1);
        js.touch();
        return reply('✅ *Note deleted.*');
      }
      if (a === 'clear') {
        b.notes = [];
        js.touch();
        return reply('✅ *All your notes were deleted.*');
      }
      if (!b.notes.length) return reply(`You have no notes yet.\n\`${prefix}note add buy bread\``);
      return reply(`*Your notes* (${b.notes.length})\n${b.notes.map((n, i) => `${i + 1}. ${n.t.length > 60 ? `${n.t.slice(0, 60)}…` : n.t}`).join('\n')}\n\n_Open one with ${prefix}note get <number>._`);
    },
  },
  {
    name: 'todo',
    aliases: ['tasks'],
    category: 'tools',
    needs: [],
    weight: 'light',
    description: 'Your private to-do list (in a private chat): todo add <task>, todo, todo done 2, todo del 2, todo clear',
    async run(ctx) {
      const blocked = need(ctx);
      if (blocked) return blocked;
      const { args, rest, reply, prefix, myIds } = ctx;
      const b = book(myIds[0]);
      const a = (args[0] || 'list').toLowerCase();
      const body = rest.slice(args[0] ? args[0].length : 0).trim();
      const at = num(body) - 1;

      if (a === 'add') {
        if (!body) return reply(`Write the task after add.\nExample: ${prefix}todo add call mum`);
        if (body.length > 200) return reply('⚠️ A task can be up to 200 characters.');
        if (b.todos.length >= MAX) return reply(`⚠️ You have ${MAX} tasks already. Clear some first.`);
        b.todos.push({ t: body, done: false });
        js.touch();
        return reply(`✅ *Task ${b.todos.length} added.*`);
      }
      if (a === 'done' || a === 'undone') {
        if (!b.todos[at]) return reply(`⚠️ There is no task ${body || ''}. See ${prefix}todo.`);
        b.todos[at].done = a === 'done';
        js.touch();
        return reply(a === 'done' ? `☑ *Done:* ${b.todos[at].t}` : `☐ *Open again:* ${b.todos[at].t}`);
      }
      if (a === 'del' || a === 'delete' || a === 'remove') {
        if (!b.todos[at]) return reply(`⚠️ There is no task ${body || ''}. See ${prefix}todo.`);
        b.todos.splice(at, 1);
        js.touch();
        return reply('✅ *Task deleted.*');
      }
      if (a === 'clear') {
        const before = b.todos.length;
        b.todos = body.toLowerCase() === 'all' ? [] : b.todos.filter((t) => !t.done);
        js.touch();
        return reply(`✅ *${before - b.todos.length} task${before - b.todos.length === 1 ? '' : 's'} cleared.*${body.toLowerCase() === 'all' ? '' : '\n_Only finished tasks. Use todo clear all for everything._'}`);
      }
      if (!b.todos.length) return reply(`Your to-do list is empty.\n\`${prefix}todo add call mum\``);
      const open = b.todos.filter((t) => !t.done).length;
      return reply(`*Your to-do list*  _${open} open, ${b.todos.length - open} done_\n${b.todos.map((t, i) => `${t.done ? '☑' : '☐'} ${i + 1}. ${t.done ? `~${t.t}~` : t.t}`).join('\n')}`);
    },
  },
];
