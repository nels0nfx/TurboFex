// New tools (v1.0.7): calendar, dateadd, loan, interest, fuelcost, teams, shuffle, habit, shoplist, gradecalc
const clock = require('../core/clock');
const jsonstore = require('../core/jsonstore');
const levels = require('../whatsapp/levels');
const { num } = require('../whatsapp/utils');

const base = { category: 'tools', needs: [], weight: 'light' };
const money = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf = (n, d = 2) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d });
const numbers = (args) => args.map((a) => Number(String(a).replace(/,/g, '').replace(/%$/, '')));
const bad = (reply, text) => reply(`⚠️ *${text}*`);

// ---------------------------------------------------------------- dates
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d, 12));
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const today = () => {
  const p = clock.parts();
  return { y: p.y, m: p.mo, d: p.dom };
};
const label = (dt) => `${DAYS[dt.getUTCDay()]} ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()][0].toUpperCase()}${MONTHS[dt.getUTCMonth()].slice(1, 3)} ${dt.getUTCFullYear()}`;

// "2026-12-25" or "25/12/2026" -> a date, or null
function readDate(text) {
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  let y;
  let mo;
  let d;
  if (m) [y, mo, d] = [+m[1], +m[2], +m[3]];
  else if ((m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(text))) [d, mo, y] = [+m[1], +m[2], +m[3]];
  else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo) || y < 1900 || y > 2200) return null;
  return utc(y, mo, d);
}

// adds days, weeks, months or years (a month never skips over the end of the month: 31 Jan + 1 month = 28/29 Feb)
function addTo(dt, n, unit) {
  if (unit === 'd' || unit === 'w') return new Date(dt.getTime() + n * (unit === 'w' ? 7 : 1) * 86400000);
  let y = dt.getUTCFullYear();
  let m = dt.getUTCMonth() + (unit === 'y' ? n * 12 : n);
  y += Math.floor(m / 12);
  m = ((m % 12) + 12) % 12;
  return utc(y, m + 1, Math.min(dt.getUTCDate(), daysIn(y, m + 1)));
}

// ---------------------------------------------------------------- saved things (habits, shopping lists)
const habits = jsonstore.open('habits', { users: {} }, { delay: 2000 });
const shopping = jsonstore.open('shoplist', { chats: {} }, { delay: 2000 });
const dayKey = (ts = Date.now()) => {
  const p = clock.parts(new Date(ts));
  return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.dom).padStart(2, '0')}`;
};
const habitsOf = (key) => ((habits.data.users = habits.data.users || {})[key] = habits.data.users[key] || []);
const listOf = (jid) => ((shopping.data.chats = shopping.data.chats || {})[jid] = shopping.data.chats[jid] || []);

module.exports = [
  {
    ...base,
    name: 'calendar',
    aliases: ['cal', 'month'],
    description: 'A calendar of a month: calendar, calendar 12 2026, calendar march, calendar sun (week starts on Sunday)',
    async run({ args, reply }) {
      const t = today();
      let y = t.y;
      let m = t.m;
      let sunday = false;
      const nums = [];
      for (const a of args) {
        const w = a.toLowerCase();
        if (w === 'sun' || w === 'sunday') sunday = true;
        else if (MONTHS.findIndex((n) => n.startsWith(w.slice(0, 3)) && w.length >= 3) >= 0) m = MONTHS.findIndex((n) => n.startsWith(w.slice(0, 3))) + 1;
        else if (/^\d{4}-\d{1,2}$/.test(w)) [y, m] = w.split('-').map(Number);
        else if (/^\d+$/.test(w)) nums.push(Number(w));
      }
      for (const n of nums) {
        if (n >= 1000) y = n;
        else if (n >= 1 && n <= 12) m = n;
      }
      if (y < 1900 || y > 2200 || m < 1 || m > 12) return bad(reply, 'Use a month from 1 to 12 and a year from 1900 to 2200.');
      const first = (utc(y, m, 1).getUTCDay() + (sunday ? 0 : 6)) % 7; // the column of the 1st
      const head = sunday ? 'Su Mo Tu We Th Fr Sa' : 'Mo Tu We Th Fr Sa Su';
      const cells = Array(first).fill('  ').concat(Array.from({ length: daysIn(y, m) }, (_, i) => String(i + 1).padStart(2, ' ')));
      const rows = [];
      for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7).join(' '));
      const isNow = y === t.y && m === t.m;
      return reply(`📅 *${MONTHS[m - 1][0].toUpperCase()}${MONTHS[m - 1].slice(1)} ${y}*\n\`\`\`\n${head}\n${rows.join('\n')}\n\`\`\`${isNow ? `\n_Today is ${label(utc(t.y, t.m, t.d))}_` : ''}`);
    },
  },

  {
    ...base,
    name: 'dateadd',
    aliases: ['dateplus', 'daysfrom'],
    description: 'Add or take away days, weeks, months or years: dateadd +45 days, dateadd 2026-12-25 -2 weeks',
    async run({ rest, reply, prefix }) {
      const usage = `📆 *Usage:* \`${prefix}dateadd <date> +<number> <days|weeks|months|years>\`\n*Examples:*\n▸ \`${prefix}dateadd +45 days\` _(from today)_\n▸ \`${prefix}dateadd 2026-12-25 -2 weeks\`\n▸ \`${prefix}dateadd 25/12/2026 +1 month\``;
      const m = /^(?:(\S+)\s+)?([+-]?\d+)\s*(d|day|days|w|week|weeks|m|month|months|y|year|years)?$/i.exec(rest.trim());
      if (!m) return reply(usage);
      let from;
      if (m[1] && m[1].toLowerCase() !== 'today') {
        from = readDate(m[1]);
        if (!from) return bad(reply, 'I could not read that date. Use 2026-12-25 or 25/12/2026.');
      } else {
        const t = today();
        from = utc(t.y, t.m, t.d);
      }
      const n = parseInt(m[2], 10);
      const unit = (m[3] || 'd')[0].toLowerCase();
      if (Math.abs(n) > 100000) return bad(reply, 'That number is too big.');
      const to = addTo(from, n, unit);
      if (to.getUTCFullYear() < 1900 || to.getUTCFullYear() > 2200) return bad(reply, 'That date is too far away.');
      return reply(`📆 *${label(from)}*\n${n >= 0 ? '+' : '-'} ${Math.abs(n)} ${{ d: 'day', w: 'week', m: 'month', y: 'year' }[unit]}${Math.abs(n) === 1 ? '' : 's'}\n= *${label(to)}*`);
    },
  },

  {
    ...base,
    name: 'loan',
    aliases: ['mortgage', 'repayment'],
    description: 'Monthly payment of a loan: loan 10000 12 2 (amount, yearly interest %, years; add m for months: loan 5000 15 18m)',
    async run({ args, reply, prefix }) {
      const [p, rate] = numbers(args);
      const term = String(args[2] || '');
      const isMonths = /m$/i.test(term);
      const n = Math.round(parseFloat(term) * (isMonths ? 1 : 12));
      if (!(p > 0) || !(rate >= 0) || !(n >= 1)) return reply(`💳 *Usage:* \`${prefix}loan <amount> <yearly interest %> <years>\`\n*Example:* \`${prefix}loan 10000 12 2\` _(or_ \`${prefix}loan 5000 15 18m\` _for 18 months)_`);
      if (n > 600 || rate > 200 || p > 1e12) return bad(reply, 'Those numbers are too big. The longest loan is 50 years.');
      const r = rate / 100 / 12;
      const pay = r === 0 ? p / n : (p * r) / (1 - (1 + r) ** -n);
      const total = pay * n;
      return reply(`💳 *Loan*\n*Amount:* ${money(p)}\n*Interest:* ${nf(rate)}% a year\n*Time:* ${n} months\n\n💰 *Monthly payment:* ${money(pay)}\n🧾 *Total paid back:* ${money(total)}\n📈 *Interest paid:* ${money(total - p)}\n_The interest is worked out on what you still owe each month._`);
    },
  },

  {
    ...base,
    name: 'interest',
    aliases: ['savings', 'compound'],
    description: 'How savings grow: interest 5000 7 10 (amount, yearly %, years) or interest 5000 7 10 add 200 (monthly deposit)',
    async run({ args, reply, prefix }) {
      const addAt = args.findIndex((a) => a.toLowerCase() === 'add');
      const main = addAt >= 0 ? args.slice(0, addAt) : args;
      const [p, rate, years] = numbers(main);
      const deposit = addAt >= 0 ? Number(String(args[addAt + 1] || '').replace(/,/g, '')) : 0;
      if (!(p >= 0) || !(rate >= 0) || !(years > 0) || !(deposit >= 0) || (!p && !deposit)) return reply(`🏦 *Usage:* \`${prefix}interest <amount> <yearly %> <years>\`\n*Example:* \`${prefix}interest 5000 7 10\`\n*With a monthly deposit:* \`${prefix}interest 5000 7 10 add 200\``);
      if (years > 80 || rate > 100 || p > 1e12 || deposit > 1e9) return bad(reply, 'Those numbers are too big.');
      const months = Math.round(years * 12);
      const r = rate / 100 / 12;
      let bal = p;
      for (let i = 0; i < months; i++) bal = bal * (1 + r) + deposit;
      const put = p + deposit * months;
      return reply(`🏦 *Savings growth*\n*Start:* ${money(p)}${deposit ? `\n*Every month:* ${money(deposit)}` : ''}\n*Interest:* ${nf(rate)}% a year, added every month\n*Time:* ${nf(years, 1)} years\n\n💰 *You will have:* ${money(bal)}\n📥 *You put in:* ${money(put)}\n📈 *Interest earned:* ${money(bal - put)}`);
    },
  },

  {
    ...base,
    name: 'fuelcost',
    aliases: ['tripcost', 'petrolcost'],
    description: 'Cost of a trip: fuelcost 120 8 1.5 (distance in km, litres per 100 km, price of a litre; add return for both ways)',
    async run({ args, reply, prefix }) {
      const both = args.some((a) => /^(return|both|round)$/i.test(a));
      const [km, per100, price] = numbers(args.filter((a) => !/^(return|both|round)$/i.test(a)));
      if (!(km > 0) || !(per100 > 0) || !(price >= 0)) return reply(`⛽ *Usage:* \`${prefix}fuelcost <km> <litres per 100 km> <price of a litre>\`\n*Example:* \`${prefix}fuelcost 120 8 1.5\` _(add_ \`return\` _for both ways)_`);
      if (km > 100000 || per100 > 100) return bad(reply, 'Those numbers are too big.');
      const distance = km * (both ? 2 : 1);
      const litres = (distance * per100) / 100;
      return reply(`⛽ *Trip cost*\n*Distance:* ${nf(distance)} km${both ? ' (there and back)' : ''}\n*Fuel needed:* ${nf(litres)} litres\n*Fuel price:* ${money(price)} a litre\n\n💰 *Total:* ${money(litres * price)}`);
    },
  },

  {
    ...base,
    name: 'teams',
    aliases: ['maketeams', 'splitteams'],
    description: 'Split people into random teams: teams 2 Ann Ben Cara Dan (or just teams 3 in a group to split the members)',
    async run({ args, reply, prefix, isGroup, groupMetadata: meta, botIds }) {
      const n = parseInt(args[0], 10);
      let names = args.slice(1).join(' ').split(/[,\n]+|\s+/).map((x) => x.trim()).filter(Boolean);
      let mentions = [];
      if (!(n >= 2 && n <= 10)) return reply(`👥 *Usage:* \`${prefix}teams <number of teams> <names>\`\n*Example:* \`${prefix}teams 2 Ann Ben Cara Dan\`\n_In a group:_ \`${prefix}teams 3\` _splits all the members._`);
      if (!names.length) {
        if (!isGroup) return reply(`👥 Write the names after the number: \`${prefix}teams ${n} Ann Ben Cara Dan\``);
        const ids = (meta?.participants || []).map((p) => p.id).filter((j) => !botIds.includes(num(j))).slice(0, 60);
        names = ids.map((j) => `@${num(j)}`);
        mentions = ids;
      }
      if (names.length < n) return bad(reply, `I need at least ${n} names for ${n} teams.`);
      if (names.length > 60) return bad(reply, 'That is too many names (the limit is 60).');
      const order = names.map((x, i) => [Math.random(), x, i]).sort((a, b) => a[0] - b[0]);
      const out = Array.from({ length: n }, () => []);
      order.forEach(([, x], i) => out[i % n].push(x));
      const icons = ['🔴', '🔵', '🟢', '🟡', '🟣', '🟠', '⚫', '⚪', '🟤', '🩷'];
      return reply(`👥 *${n} teams*\n\n${out.map((t, i) => `${icons[i]} *Team ${i + 1}*\n${t.join(', ')}`).join('\n\n')}`, { mentions });
    },
  },

  {
    ...base,
    name: 'shuffle',
    aliases: ['randomorder', 'mixup'],
    description: 'Put a list in random order: shuffle Ann, Ben, Cara, Dan',
    async run({ rest, reply, prefix }) {
      const items = (rest.includes(',') || rest.includes('\n') ? rest.split(/[,\n]+/) : rest.split(/\s+/)).map((x) => x.trim()).filter(Boolean);
      if (items.length < 2) return reply(`🔀 *Usage:* \`${prefix}shuffle <items separated by commas>\`\n*Example:* \`${prefix}shuffle Ann, Ben, Cara, Dan\``);
      if (items.length > 50) return bad(reply, 'That is too many items (the limit is 50).');
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }
      return reply(`🔀 *Random order*\n\n${items.map((x, i) => `*${i + 1}.* ${x}`).join('\n')}`);
    },
  },

  {
    ...base,
    name: 'habit',
    aliases: ['habits', 'streak'],
    description: 'Keep daily habits and count your streak: habit add exercise, habit done 1, habit (see your list)',
    async run({ args, rest, myJid, reply, prefix }) {
      const key = levels.keyOf(myJid);
      const list = habitsOf(key);
      const w = (args[0] || '').toLowerCase();
      const t = dayKey();
      const yesterday = dayKey(Date.now() - 86400000);
      const pick = (what) => {
        const i = parseInt(what, 10);
        if (i >= 1 && i <= list.length) return list[i - 1];
        const q = String(what || '').toLowerCase();
        return list.find((h) => h.name.toLowerCase() === q) || list.find((h) => q && h.name.toLowerCase().startsWith(q)) || list.find((h) => q && h.name.toLowerCase().includes(q));
      };
      if (w === 'add' || w === 'new') {
        const name = rest.slice(w.length).trim().slice(0, 40);
        if (!name) return reply(`*Usage:* \`${prefix}habit add exercise\``);
        if (list.length >= 10) return bad(reply, 'You can keep 10 habits. Remove one first.');
        if (list.some((h) => h.name.toLowerCase() === name.toLowerCase())) return reply('ℹ️ *You already have that habit.*');
        list.push({ name, streak: 0, best: 0, last: '', total: 0 });
        habits.touch();
        return reply(`✅ *Habit added:* ${name}\n_Every day you do it, send_ \`${prefix}habit done ${list.length}\``);
      }
      if (w === 'done' || w === 'check') {
        const h = pick(args.slice(1).join(' ') || (list.length === 1 ? '1' : ''));
        if (!h) return reply(`*Usage:* \`${prefix}habit done <number or name>\`${list.length ? '' : `\n_Add one first:_ \`${prefix}habit add exercise\``}`);
        if (h.last === t) return reply(`ℹ️ *${h.name}* is already done today. 🔥 Streak: ${h.streak}`);
        h.streak = h.last === yesterday ? h.streak + 1 : 1;
        h.best = Math.max(h.best, h.streak);
        h.last = t;
        h.total += 1;
        habits.touch();
        return reply(`✅ *${h.name}* done!\n🔥 *Streak:* ${h.streak} day${h.streak === 1 ? '' : 's'}${h.streak === h.best && h.streak > 1 ? ' (your best!)' : ''}`);
      }
      if (w === 'remove' || w === 'delete') {
        const h = pick(args.slice(1).join(' '));
        if (!h) return reply(`*Usage:* \`${prefix}habit remove <number or name>\``);
        list.splice(list.indexOf(h), 1);
        habits.touch();
        return reply(`🗑️ *Removed:* ${h.name}`);
      }
      if (!list.length) return reply(`🌱 *No habits yet.*\n*Start:* \`${prefix}habit add drink water\`\n_Do it every day to build a streak._`);
      // a streak that was not kept up yesterday or today is over
      const view = list.map((h, i) => {
        const alive = h.last === t || h.last === yesterday;
        return `*${i + 1}.* ${h.last === t ? '✅' : '⬜'} ${h.name} - 🔥 ${alive ? h.streak : 0} _(best ${h.best})_`;
      });
      return reply(`🌱 *Your habits*\n\n${view.join('\n')}\n\n\`${prefix}habit done <number>\` · \`${prefix}habit add <name>\` · \`${prefix}habit remove <number>\``);
    },
  },

  {
    ...base,
    name: 'shoplist',
    aliases: ['shopping', 'groceries'],
    description: 'A shopping list for the chat: shoplist add milk, eggs / shoplist done 2 / shoplist remove 3 / shoplist clear',
    async run({ jid, args, rest, reply, prefix, isGroup, isAdmin, isOwner }) {
      const list = listOf(jid);
      const w = (args[0] || '').toLowerCase();
      const show = () =>
        list.length
          ? `🛒 *Shopping list*\n\n${list.map((it, i) => `*${i + 1}.* ${it.done ? '✅ ~' + it.t + '~' : it.t}`).join('\n')}\n\n\`${prefix}shoplist add <items>\` · \`done <number>\` · \`remove <number>\``
          : `🛒 *The list is empty.*\n*Add:* \`${prefix}shoplist add milk, eggs, bread\``;
      if (w === 'add') {
        const items = rest.slice(3).split(/[,\n]+/).map((x) => x.trim().slice(0, 80)).filter(Boolean);
        if (!items.length) return reply(`*Usage:* \`${prefix}shoplist add milk, eggs, bread\``);
        if (list.length + items.length > 50) return bad(reply, 'The list can hold 50 items.');
        for (const t of items) list.push({ t, done: false });
        shopping.touch();
        return reply(`✅ *Added ${items.length} item${items.length > 1 ? 's' : ''}.*\n\n${show()}`);
      }
      if (w === 'done' || w === 'bought' || w === 'remove' || w === 'delete') {
        const nums = args.slice(1).map((a) => parseInt(a, 10)).filter((i) => i >= 1 && i <= list.length);
        if (!nums.length) return reply(`*Usage:* \`${prefix}shoplist ${w} <number>\`\n_See the numbers with_ \`${prefix}shoplist\``);
        if (w === 'done' || w === 'bought') for (const i of nums) list[i - 1].done = true;
        else for (const i of [...new Set(nums)].sort((a, b) => b - a)) list.splice(i - 1, 1);
        shopping.touch();
        return reply(show());
      }
      if (w === 'clear') {
        if (isGroup && !(isAdmin || isOwner)) return; // not allowed: stay silent
        list.length = 0;
        shopping.touch();
        return reply('🧹 *The shopping list was cleared.*');
      }
      return reply(show());
    },
  },

  {
    ...base,
    name: 'gradecalc',
    aliases: ['grade', 'average'],
    description: 'Your average or final grade: gradecalc 70 85 90 / with weights gradecalc 70x30 85x20 / what you need: gradecalc 70x30 85x20 need 80',
    async run({ args, reply, prefix }) {
      const needAt = args.findIndex((a) => a.toLowerCase() === 'need');
      const target = needAt >= 0 ? Number(args[needAt + 1]) : null;
      const marks = (needAt >= 0 ? args.slice(0, needAt) : args).map((a) => /^(\d+(?:\.\d+)?)(?:x(\d+(?:\.\d+)?))?$/i.exec(a.replace(/%/g, '')));
      const usage = `🎓 *Usage:*\n▸ \`${prefix}gradecalc 70 85 90\` _(simple average)_\n▸ \`${prefix}gradecalc 70x30 85x20\` _(mark x weight in %)_\n▸ \`${prefix}gradecalc 70x30 85x20 need 80\` _(what you must score on the rest to reach 80)_`;
      if (!marks.length || marks.some((m) => !m) || (needAt >= 0 && !(target >= 0 && target <= 100))) return reply(usage);
      if (marks.length > 50 || marks.some((m) => +m[1] > 1000)) return bad(reply, 'Those numbers look wrong.');
      const weighted = marks.some((m) => m[2] !== undefined);
      if (weighted && marks.some((m) => m[2] === undefined)) return bad(reply, 'Give a weight for every mark (70x30), or for none.');
      if (!weighted) {
        const v = marks.map((m) => +m[1]);
        const avg = v.reduce((a, b) => a + b, 0) / v.length;
        if (target !== null) return reply('ℹ️ *To find what you need, give weights:* `' + prefix + 'gradecalc 70x30 85x20 need 80`');
        return reply(`🎓 *Average:* ${nf(avg)}%\n*Marks:* ${v.length} · *Highest:* ${nf(Math.max(...v))} · *Lowest:* ${nf(Math.min(...v))}`);
      }
      const used = marks.reduce((a, m) => a + +m[2], 0);
      const got = marks.reduce((a, m) => a + (+m[1] * +m[2]) / 100, 0); // points earned out of the weight used
      if (used > 100) return bad(reply, 'The weights add up to more than 100%.');
      if (target !== null) {
        if (used >= 100) return reply(`🎓 *Your final grade is ${nf(got)}%.* There is nothing left to score.`);
        const need = ((target - got) / (100 - used)) * 100;
        return reply(`🎓 *Target: ${nf(target)}%*\n*So far:* ${nf(got)} points from ${nf(used)}% of the course\n*Left to score:* ${nf(100 - used)}%\n\n🎯 *You need ${need <= 0 ? 'nothing more: you have already reached it!' : need > 100 ? `${nf(need)}% on the rest, which is more than 100%: it is not possible any more.` : `${nf(need)}% on the rest.`}*`);
      }
      return reply(`🎓 *${used >= 100 ? 'Final grade' : 'Grade so far'}:* ${nf(used >= 100 ? got : (got / used) * 100)}%\n*Weights used:* ${nf(used)}% of 100%${used < 100 ? `\n_Add_ \`need 80\` _to see what you need on the rest._` : ''}`);
    },
  },
];
