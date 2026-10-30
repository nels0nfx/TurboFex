// God: the main bot owner. God does not rule the realms, God sets the limits and can change anything that exists.
// Works in a group (that realm) and in a private chat (the realm chosen with "god realm").
const settings = require('../core/realm/settings');
const god = require('../core/realm/god');
const ledger = require('../core/realm/ledger');
const A = require('../core/realm/aurum');
const S = require('../core/realm/state');
const ui = require('../core/realm/ui');
const groups = require('../whatsapp/groups');
const stuff = require('../core/realm/stuff');
const estates = require('../core/realm/estates');
const careers = require('../core/realm/careers');
const market = require('../core/realm/market');
const auction = require('../core/realm/auction');
const { resolveTarget } = require('../whatsapp/utils');

const godCoreStock = (g) => god.realmStock(g);
const isNumberToken = (t) => /^@?\+?\d{7,15}$/.test(t);
const CONFIRM = 'confirm';

// the realm God means: this group, or the one chosen in the private chat
const realmOf = (ctx) => (ctx.isGroup ? ctx.jid : god.selected());
async function nameOf(sock, group) {
  try {
    const g = (await groups.list(sock)).find((x) => x.jid === group);
    return g ? g.name : group;
  } catch (err) {
    return group;
  }
}
// tells the people of the realm that God did something (when God does it from somewhere else)
// "mentions" are the people tagged in the text (@number): they are tagged for real, so WhatsApp shows their name in the group
async function announce(ctx, group, text, mentions = []) {
  if (!group || group === ctx.jid || !settings.get('god.announce', group)) return;
  try {
    const content = { text: `☀️ *The heavens have spoken*\n${text}` };
    if (mentions.length) content.mentions = mentions; // the connection then gives each tag the id the group uses (see whatsapp/mentions.js)
    await ctx.sock.sendMessage(group, content);
  } catch (err) {
    // the group may be gone; the ledger has it anyway
  }
}
const showVal = (full, group) => settings.show(settings.defOf(full), settings.get(full, group));

const HELP = (p) =>
  ui.card(
    '☀️',
    'God',
    [
      '*Look*',
      `\`${p}god settings\` – every feature and its numbers`,
      `\`${p}god settings core\` – the numbers of one feature`,
      `\`${p}god ledger\` – what God changed lately`,
      '',
      '*Change the rules*',
      `\`${p}god set core.dailyBase 400\` – for all realms`,
      `\`${p}god set core.dailyBase 400 here\` – for one realm only`,
      `\`${p}god reset core.dailyBase [here]\``,
      `\`${p}god off shop [here]\` • \`${p}god on shop [here]\` – switch a whole feature`,
      '',
      '*Change the people*',
      `\`${p}god give @user 500\` • \`${p}god take @user 500\` • \`${p}god purse @user 1000\``,
      `\`${p}god rank @user lord\` (or \`normal\`)`,
      `\`${p}god bless @user 50 12\` • \`${p}god curse @user 30 6\` • \`${p}god clear @user\``,
      `\`${p}god item @user bread 5\` (a minus takes it away) • \`${p}god estate @user farm 3\` (0 removes it) • \`${p}god career @user smith\``,
      `\`${p}god stock\` – the goods the realm kept as tax`,
      `\`${p}god price grain 12\` • \`${p}god event [name]\` • \`${p}god herald\` • \`${p}god market reset confirm\``,
      `\`${p}god auction end 3\` • \`${p}god auction cancel 3\``,
      `\`${p}god wipe @user confirm\` • \`${p}god wipe realm confirm\``,
      '',
      '*The realms*',
      `\`${p}god realm 2\` – choose the realm in a private chat`,
      `\`${p}god realm off\` / \`${p}god realm on\` (add \`all\` for every realm)`,
      `\`${p}god move 1 to 2 [number] [copy]\``,
    ],
    [],
    'Every change is written in the ledger. A realm number comes from the groups list.'
  );

module.exports = [
  {
    name: 'god',
    aliases: ['divine', 'heavens'],
    category: 'owner',
    realOwnerOnly: true,
    needs: [],
    weight: 'light',
    description: 'God (the bot owner): set the limits of the Empire and change anything in it. Send god for the list',
    async run(ctx) {
      const { sock, msg, args, reply, prefix } = ctx;
      const sub = (args[0] || '').toLowerCase();
      const group = realmOf(ctx);
      const needRealm = () => reply(ui.card('☀️', 'Choose a realm first', ['This needs a realm.'], [`\`${prefix}god realm 1\` (the number comes from \`${prefix}gjids\`)`]));

      // ---------------------------------------------------------- overview
      if (!sub) {
        const here = group ? `*Realm:* ${await nameOf(sock, group)} ${S.isOn(group) ? '✅' : '🔒'}` : `*Realm:* none chosen (\`${prefix}god realm 1\`)`;
        return reply(`${here}\n\n${HELP(prefix)}`);
      }

      // ---------------------------------------------------------- the realm: choose, close, open
      if (sub === 'realm') {
        const word = (args[1] || '').toLowerCase();
        if (word === 'on' || word === 'off') {
          const on = word === 'on';
          if ((args[2] || '').toLowerCase() === 'all') {
            const all = new Set([...god.realmsWithData().keys(), ...Object.keys(S.js.data.realms)]);
            for (const g of all) god.realmSwitch(g, on);
            return reply(ui.card(on ? '⚜️' : '🔒', on ? 'Every realm is open' : 'Every realm is closed', [`${all.size} realm${all.size === 1 ? '' : 's'}.`, on ? '' : 'Nothing was deleted.'].filter(Boolean)));
          }
          if (!group) return needRealm();
          god.realmSwitch(group, on);
          await announce(ctx, group, on ? 'The realm is open again.' : 'The realm is closed.');
          return reply(ui.card(on ? '⚜️' : '🔒', on ? 'The realm is open' : 'The realm is closed', [`*${await nameOf(sock, group)}*`]));
        }
        if (!word) {
          if (!group) return needRealm();
          return reply(ui.card('☀️', 'Your realm', [`*${await nameOf(sock, group)}* ${S.isOn(group) ? '✅ open' : '🔒 closed'}`, `*Citizens:* ${S.citizensOf(group).length}`, `*Treasury:* ${ui.money(A.treasury(group))}`], [`\`${prefix}god realm 2\` – choose another`]));
        }
        const g = await groups.resolve(sock, args.slice(1).join(' '));
        if (!g) return reply(ui.warn('I could not find that group. Use the number from the groups list, or part of the name.'));
        god.select(g.jid);
        return reply(ui.card('☀️', 'Realm chosen', [`*${g.name}*`, 'Every Empire command you send in a private chat now works in this realm.'], [`\`${prefix}purse\` • \`${prefix}god settings\``]));
      }

      // ---------------------------------------------------------- settings
      if (sub === 'settings' || sub === 'rules' || sub === 'list') {
        const f = args[1] ? settings.one(args[1].toLowerCase()) : null;
        if (!f) {
          const rows = settings.list().map((x) => `${x.icon} *${x.id}* – ${x.title}: ${settings.featureOn(x.id, group) ? '✅' : '🔒 off'}, ${x.settings.size - 1} numbers\n   _${x.about}_`);
          return reply(ui.card('⚙️', 'The features', rows, [`\`${prefix}god settings core\` – see the numbers of one`, `\`${prefix}god set core.dailyBase 400\` – change one`]));
        }
        const rows = [];
        for (const [key, d] of f.settings) {
          const full = `${f.id}.${key}`;
          const src = settings.sourceOf(full, group);
          rows.push(`*${key}* = ${showVal(full, group)}${src === 'default' ? '' : src === 'realm' ? ' 🔸this realm' : ' 🔹all realms'}\n   _${d.label}${d.kind === 'bool' ? '' : ` (${d.min}–${d.max})`}_`);
        }
        return reply(ui.card(f.icon, f.title, rows, [`\`${prefix}god set ${f.id}.<name> <value> [here]\``], '🔹 changed for all realms • 🔸 changed for this realm only'));
      }
      if (sub === 'set' || sub === 'reset') {
        const found = settings.find(args[1]);
        if (!found) return reply(ui.warn(`I do not know that setting. See \`${prefix}god settings\`.`));
        const rest = args.slice(2);
        const here = rest.some((a) => /^(here|realm)$/i.test(a));
        const value = rest.filter((a) => !/^(here|realm|all)$/i.test(a)).join('');
        if (here && !group) return needRealm();
        const scope = here ? group : null;
        if (sub === 'reset') {
          const r = god.resetSetting(found.full, scope);
          return reply(ui.card('⚙️', 'Setting reset', [`*${found.full}* is back to ${showVal(found.full, scope)}`, here ? `_(only for ${await nameOf(sock, group)})_` : '_(for all realms)_']));
        }
        if (!value) return reply(ui.card('⚙️', found.full, [`*Now:* ${showVal(found.full, group)}`, `_${found.def.label}_`, found.def.kind === 'bool' ? '*Allowed:* on or off' : `*Allowed:* ${found.def.min} to ${found.def.max}`], [`\`${prefix}god set ${found.full} <value> [here]\``]));
        const r = god.setSetting(found.full, value, scope);
        if (!r.ok) return reply(ui.warn(`${found.full}: ${r.error}`));
        await announce(ctx, scope, `${found.def.label}: now ${showVal(found.full, scope)}.`);
        return reply(ui.card('✅', 'Setting changed', [`*${found.full}*`, `${settings.show(found.def, r.before)} → *${settings.show(found.def, r.value)}*`, here ? `_Only for ${await nameOf(sock, group)}_` : '_For all realms (a realm with its own value keeps it)_']));
      }
      if (sub === 'on' || sub === 'off') {
        const f = settings.one((args[1] || '').toLowerCase());
        if (!f || f.id === 'god') return reply(ui.warn(`Name a feature: ${settings.list().filter((x) => x.id !== 'god').map((x) => x.id).join(', ')}`));
        const here = (args[2] || '').toLowerCase() === 'here';
        if (here && !group) return needRealm();
        const r = god.setSetting(`${f.id}.on`, sub === 'on', here ? group : null);
        await announce(ctx, here ? group : null, `${f.title} is ${sub === 'on' ? 'open' : 'closed'}.`);
        return reply(ui.card(sub === 'on' ? '✅' : '🔒', `${f.title} is ${sub === 'on' ? 'open' : 'closed'}`, [here ? `_Only for ${await nameOf(sock, group)}_` : '_For all realms_', r.ok ? '' : r.error].filter(Boolean)));
      }

      // ---------------------------------------------------------- ledger
      if (sub === 'ledger' || sub === 'log') {
        const n = Math.min(25, Math.max(1, parseInt(args[1], 10) || 10));
        const rows = ledger.recent(n, null);
        if (!rows.length) return reply(ui.card('📒', 'The ledger', ['Nothing has been changed yet.']));
        const lines = rows.map((r) => `• ${new Date(r.at).toISOString().slice(5, 16).replace('T', ' ')} *${r.action}*${r.target ? ` ${r.target}` : ''}${r.detail ? ` – ${r.detail}` : ''}`);
        return reply(ui.card('📒', 'The Divine Ledger', lines, [`\`${prefix}god ledger 20\` – more`], `${ledger.count()} entries kept`));
      }

      // ---------------------------------------------------------- move data
      if (sub === 'move' || sub === 'copy') {
        const words = args.slice(1);
        const at = words.findIndex((w) => w.toLowerCase() === 'to');
        if (at < 1) return reply(ui.card('📦', 'Move citizens', ['Moves Aurum, bank, titles and items of citizens from one realm to another.'], [`\`${prefix}god move 1 to 2\` – everybody`, `\`${prefix}god move 1 to 2 2348012345678\` – one person`, 'Add `copy` to keep the data in the first realm too.']));
        const copy = sub === 'copy' || words.some((w) => w.toLowerCase() === 'copy');
        const rest = words.slice(at + 1).filter((w) => w.toLowerCase() !== 'copy');
        const personWord = rest.find((w) => isNumberToken(w));
        const from = await groups.resolve(sock, words.slice(0, at).join(' '));
        const to = await groups.resolve(sock, rest.filter((w) => w !== personWord).join(' '));
        if (!from || !to) return reply(ui.warn(`I could not find the ${!from ? 'first' : 'second'} group.`));
        if (from.jid === to.jid) return reply(ui.warn('Choose two different groups.'));
        const who = personWord ? S.keyOf(`${personWord.replace(/\D/g, '')}@s.whatsapp.net`) : null;
        const moved = god.moveRealm(from.jid, to.jid, who, copy ? 'copy' : 'move');
        if (!moved.length) return reply(ui.info(`Nothing to ${copy ? 'copy' : 'move'}: ${who ? 'that person has' : 'nobody has'} data in ${from.name}.`));
        await announce(ctx, to.jid, `${moved.length} citizen${moved.length === 1 ? '' : 's'} arrived from another realm.`);
        return reply(ui.card('📦', copy ? 'Copied' : 'Moved', [`*From:* ${from.name}`, `*To:* ${to.name}`, `*Citizens:* ${moved.length}`, `*Aurum:* ${ui.fmt(moved.reduce((t, m) => t + m.worth, 0))}`], [], copy ? 'The first realm keeps its data.' : 'They are gone from the first realm.'));
      }

      // ---------------------------------------------------------- wipe
      if (sub === 'wipe') {
        const sure = args.some((a) => a.toLowerCase() === CONFIRM);
        const target = resolveTarget(msg, args.slice(1));
        const wholeRealm = (args[1] || '').toLowerCase() === 'realm';
        if (!group) return needRealm();
        if (!wholeRealm && !target) return reply(ui.card('🗑️', 'Wipe', ['Deletes a citizen or a whole realm. It cannot be undone.'], [`\`${prefix}god wipe @user ${CONFIRM}\``, `\`${prefix}god wipe realm ${CONFIRM}\``]));
        if (!sure) return reply(ui.warn(`This cannot be undone. Send the same command again with the word *${CONFIRM}* at the end.`));
        if (wholeRealm) {
          const r = god.wipeRealm(group);
          await announce(ctx, group, 'The realm started again from nothing.');
          return reply(ui.card('🗑️', 'Realm wiped', [`*${await nameOf(sock, group)}*`, `${r.citizens} citizens removed. The realm starts again from nothing.`]));
        }
        const r = god.wipeCitizen(group, target);
        return reply(r.ok ? ui.card('🗑️', 'Citizen wiped', [ui.tag(target)]) : ui.info('That person has no data in this realm.'), { mentions: [target] });
      }

      if (sub === 'stock') {
        if (!group) return needRealm();
        const st = Object.entries(godCoreStock(group));
        return reply(ui.card('🏺', 'The realm\'s granary', st.length ? st.map(([id, n]) => `${stuff.get(id).icon} *${stuff.get(id).name}* ×${ui.fmt(n)}`) : ['Empty. It fills with the estate tax.'], [], `Treasury: ${ui.money(A.treasury(group))}`));
      }
      if (['item', 'estate', 'career'].includes(sub)) {
        if (!group) return needRealm();
        const target = resolveTarget(msg, args.slice(1));
        if (!target) return reply(ui.warn(`Name a citizen: \`${prefix}god ${sub} @user ...\``));
        const words = args.slice(1).filter((a) => !isNumberToken(a) && !/^@/.test(a));
        const nums = words.filter((a) => /^-?\d+$/.test(a)).map(Number);
        const names = words.filter((a) => !/^-?\d+$/.test(a));
        const who = { mentions: [target] };
        if (sub === 'item') {
          const it = stuff.find(names.join(' '));
          if (!it || nums[0] === undefined) return reply(ui.warn(`\`${prefix}god item @user bread 5\` – items: ${stuff.list().map((s) => s.id).join(', ')}`));
          const r = god.giveStuff(group, target, it.id, nums[0]);
          await announce(ctx, group, `${ui.tag(target)} ${nums[0] > 0 ? 'received' : 'lost'} ${Math.abs(nums[0])} ${it.name}.`, [target]);
          return reply(ui.card('☀️', nums[0] > 0 ? 'Item given' : 'Item taken', [ui.tag(target), `${it.icon} *${it.name}:* now ${r.now}`]), who);
        }
        if (sub === 'estate') {
          const e = estates.find(names.join(' '));
          if (!e || nums[0] === undefined) return reply(ui.warn(`\`${prefix}god estate @user farm 3\` – estates: ${estates.ESTATES.map((x) => x.id).join(', ')} (level 0 removes)`));
          const r = god.setEstate(group, target, e.id, nums[0]);
          if (!r.ok) return reply(ui.warn('The level must be from 0 to 50.'));
          await announce(ctx, group, r.level ? `${ui.tag(target)} now has a ${e.name} (level ${r.level}).` : `${ui.tag(target)} lost the ${e.name}.`, [target]);
          return reply(ui.card('☀️', 'Estate set', [ui.tag(target), `${e.icon} *${e.name}:* ${r.level ? `level ${r.level}` : 'removed'}`]), who);
        }
        const word = names.join(' ').toLowerCase();
        const cr = word === 'none' ? null : careers.findCareer(word);
        if (word !== 'none' && !cr) return reply(ui.warn(`Choose: ${careers.CAREERS.map((x) => x.id).join(', ')} or none`));
        god.setCareer(group, target, cr ? cr.id : null);
        return reply(ui.card('☀️', 'Career set', [ui.tag(target), cr ? `${cr.icon} *${cr.name}*` : 'no career']), who);
      }

      // ---------------------------------------------------------- the market and the auctions
      if (sub === 'price') {
        if (!group) return needRealm();
        const it = stuff.find(args[1] || '');
        const value = Number((args[2] || '').replace(/,/g, ''));
        if (!it || it.kind !== 'good' || !(value > 0)) return reply(ui.card('📈', 'Set a price', ['Sets the price of a good right now (it keeps moving after that, within the limits God set).'], [`\`${prefix}god price grain 12\` – goods: ${market.GOODS().join(', ')}`]));
        const r = god.marketPrice(group, it.id, value);
        await announce(ctx, group, `The price of ${it.name} was set to ${r.price}.`);
        return reply(ui.card('📈', 'Price set', [`${it.icon} *${it.name}:* ${r.before.toFixed(2)} → *${r.price}*`, r.price !== value ? `_Held inside the limits (the lowest and highest price God set)._` : null].filter(Boolean)));
      }
      if (sub === 'event') {
        if (!group) return needRealm();
        const word = (args[1] || '').toLowerCase();
        if (word === 'list') return reply(ui.card('⚡', 'Market events', market.EVENTS.map((e) => `*${e.id}* – ${e.text}`), [`\`${prefix}god event drought\` – make it happen now`, `\`${prefix}god event\` – a random one`]));
        if (word && !market.eventById(word)) return reply(ui.warn(`I do not know that event. See \`${prefix}god event list\`.`));
        const r = god.marketEvent(group, word || null);
        const owners = [...new Set(r.rows.flatMap((x) => market.owners(group, x.id)))].slice(0, 12);
        await announce(ctx, group, `⚡ ${r.event.text}!`, owners);
        return reply(ui.card('⚡', 'Event started', [`_${r.event.text}_`, ...r.rows.map((x) => `${stuff.get(x.id).icon} ${stuff.get(x.id).name} ${x.pct >= 0 ? '▲ +' : '▼ −'}${Math.abs(x.pct).toFixed(0)}%`)], [`\`${prefix}god herald\` – post the news in the group now`]));
      }
      if (sub === 'herald') {
        if (!group) return needRealm();
        const ed = market.edition(group, true, prefix);
        try {
          await sock.sendMessage(group, { text: ed.text, mentions: ed.mentions });
        } catch (err) {
          return reply(ui.warn('I could not post in that group.'));
        }
        return reply(ui.card('📰', 'The Herald was posted', [`*${await nameOf(sock, group)}*`, `${ed.mentions.length} people tagged.`]));
      }
      if (sub === 'market') {
        if (!group) return needRealm();
        if ((args[1] || '').toLowerCase() !== 'reset') return reply(ui.card('📈', 'Market', [], [`\`${prefix}god market reset ${CONFIRM}\` – every price starts again at the normal value`]));
        if (!args.some((a) => a.toLowerCase() === CONFIRM)) return reply(ui.warn(`Prices and news start again. Send the same command with the word *${CONFIRM}* at the end.`));
        god.marketReset(group);
        await announce(ctx, group, 'The market started again at the normal prices.');
        return reply(ui.card('📈', 'Market reset', [`*${await nameOf(sock, group)}*`, 'Every price is at the normal value again.']));
      }
      if (sub === 'auction') {
        if (!group) return needRealm();
        const how = (args[1] || '').toLowerCase();
        const id = parseInt(args[2], 10);
        if (!['end', 'cancel'].includes(how) || !(id > 0)) {
          const rows = auction.active(group).map((a) => `*#${a.id}* ${stuff.get(a.item).icon} ${stuff.get(a.item).name} ×${a.qty} – ${a.bid ? `bid ${ui.fmt(a.bid)}` : 'no bids'} • ${ui.dur(a.ends - Date.now())}`);
          return reply(ui.card('🔨', 'Auctions', rows.length ? rows : ['Nothing is running.'], [`\`${prefix}god auction end 3\` – close it now as it stands`, `\`${prefix}god auction cancel 3\` – everything goes back`]));
        }
        const r = god.auctionEnd(group, id, how);
        if (!r.ok) return reply(ui.warn('There is no such auction.'));
        if (how === 'end') {
          const m = auction.message(r.results);
          try {
            await sock.sendMessage(group, m);
          } catch (err) {
            // the result is in the ledger anyway
          }
          return reply(ui.card('🔨', 'Auction closed', [`#${id} was closed now.`]));
        }
        await announce(ctx, group, `Auction #${id} was cancelled. Goods and bids went back.`);
        return reply(ui.card('🔨', 'Auction cancelled', [`#${id}: the goods and the best bid went back.`]));
      }

      // ---------------------------------------------------------- citizens
      if (['give', 'take', 'purse', 'rank', 'bless', 'curse', 'clear'].includes(sub)) {
        if (!group) return needRealm();
        const target = resolveTarget(msg, args.slice(1));
        if (!target) return reply(ui.warn(`Name a citizen: \`${prefix}god ${sub} @user ...\``));
        const nums = args.slice(1).filter((a) => /^-?\d+(\.\d+)?$/.test(a.replace(/,/g, '')) && !isNumberToken(a)).map((a) => Number(a.replace(/,/g, '')));
        const who = { mentions: [target] };
        if (sub === 'give' || sub === 'take' || sub === 'purse') {
          if (nums[0] === undefined) return reply(ui.warn(`Give an amount: \`${prefix}god ${sub} @user 500\``));
          const r = sub === 'give' ? god.give(group, target, nums[0]) : sub === 'take' ? god.take(group, target, nums[0]) : god.setPurse(group, target, nums[0]);
          if (!r.ok) return reply(ui.warn('That did not work (is the amount right?).'));
          await announce(ctx, group, sub === 'give' ? `${ui.tag(target)} was blessed with ${ui.money(nums[0])}.` : sub === 'take' ? `${ui.tag(target)} lost ${ui.money(r.took)}.` : `The purse of ${ui.tag(target)} was set.`, [target]);
          return reply(ui.card('☀️', sub === 'give' ? 'Aurum given' : sub === 'take' ? 'Aurum taken' : 'Purse set', [ui.tag(target), `*Purse now:* ${ui.money(r.coins)}`]), who);
        }
        if (sub === 'rank') {
          const word = args.slice(1).map((a) => a.toLowerCase()).find((a) => A.RANKS.some((r) => r.id === a) || a === 'normal' || a === 'auto');
          if (!word) return reply(ui.warn(`Choose: ${A.RANKS.map((r) => r.id).join(', ')} or normal`));
          const r = god.setRank(group, target, word === 'normal' || word === 'auto' ? null : A.RANKS.findIndex((x) => x.id === word));
          await announce(ctx, group, `${ui.tag(target)} is now a ${r.rank.name}.`, [target]);
          return reply(ui.card('☀️', 'Rank set', [ui.tag(target), `${r.rank.icon} *${r.rank.name}*`]), who);
        }
        if (sub === 'clear') {
          god.fate(group, target, 0, 0);
          return reply(ui.card('☀️', 'Cleared', [`${ui.tag(target)} is neither blessed nor cursed.`]), who);
        }
        const pct = sub === 'bless' ? Math.abs(nums[0] ?? 25) : -Math.abs(nums[0] ?? 25);
        const hours = nums[1] ?? 12;
        const r = god.fate(group, target, pct, hours);
        if (!r.ok) return reply(ui.warn('Percent: up to 500 for a blessing, up to 90 for a curse. Hours: 1 to 720.'));
        await announce(ctx, group, sub === 'bless' ? `${ui.tag(target)} is blessed.` : `${ui.tag(target)} is cursed.`, [target]);
        return reply(ui.card(sub === 'bless' ? '✨' : '🌑', sub === 'bless' ? 'Blessed' : 'Cursed', [ui.tag(target), `*Pay:* ${pct > 0 ? '+' : ''}${pct}% for ${hours} hours`]), who);
      }

      return reply(`${ui.warn('I do not know that.')}\n\n${HELP(prefix)}`);
    },
  },
];
