// Every command of the Empire is made with realmCommand(). It does the same checks for all of them:
//  - in a group: the realm is that group; in a private chat: only God can use it, on the realm chosen with "god realm"
//  - the realm and the feature must be switched on
// The command gets (ctx, R) where R = { group, god, isDM }.
const S = require('./state');
const settings = require('./settings');
const god = require('./god');
const ui = require('./ui');
const civic = require('./civic');

// what a prisoner may not do
const JAILED = new Set(['work', 'weekly', 'daily', 'collect', 'trade', 'auction']);

function realmCommand(def) {
  const { feature = 'core', run, ...rest } = def;
  return {
    category: 'economy',
    everyone: true,
    needs: [],
    weight: 'light',
    ...rest,
    async run(ctx) {
      const { reply, prefix, isGroup, jid, isRealOwner } = ctx;
      let group = isGroup ? jid : null;
      const isDM = !isGroup;
      if (isDM) {
        if (!isRealOwner) return reply(ui.warn('The Empire works in groups.'));
        group = god.selected();
        if (!group) return reply(ui.card('☀️', 'Choose a realm first', ['You are in a private chat, so tell me which realm to use.'], [`\`${prefix}god realm 1\` (the number comes from \`${prefix}gjids\`)`]));
      }
      if (!S.isOn(group)) {
        return reply(ui.card('🔒', 'The realm is closed', ['The Empire of Fex is switched off in this group. Nothing was lost.'], [`An admin can open it with \`${prefix}realm on\``]));
      }
      if (feature !== 'core' && !settings.featureOn(feature, group)) {
        return reply(ui.card('🔒', 'Closed by God', [`${settings.one(feature)?.title || feature} is switched off in this realm.`]));
      }
      // a prisoner cannot earn or trade (God is never jailed)
      if (JAILED.has(rest.name) && !isRealOwner && ctx.myJid) {
        const left = civic.jailLeft(group, ctx.myJid);
        if (left > 0) return reply(ui.card('⛓️', 'You are in jail', [`${rest.name} is not possible for another *${ui.dur(left)}*.`], [`The Sovereign can pardon: \`${prefix}pardon\``]));
      }
      return run(ctx, { group, god: !!isRealOwner, isDM });
    },
  };
}

module.exports = { realmCommand };
