// The emojis the bot uses to like statuses until the owner picks their own (statusemoji command). Duplicates are removed.
const RAW = '💓,🔥,🤗,🫳,👀,🫶,🤝,🐒,🤌,🌝,😳,🙄,🙆‍♂️,😂,😅,🤣,🥲,😍,🤩,🥳,🌚,🌝,🌷,☑️,💞,💓,💗,💖,🗿,🔥,✨,🎉,🎊,🙈,⭐,😳,😭,💔,🤩😏,💀,☠️,🌈,🍸,✍️,🌼,🍀,😐,🍂,🙏,🔥,🦋,🥴,🥵,🥺,🐬,😎,🦄,🦅,😯,😇,💎,👀,🥰';
const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
// splits a text into single emojis (keeps joined emojis like 🙆‍♂️ whole)
const split = (text) => [...seg.segment(String(text || ''))].map((s) => s.segment).filter((g) => /\p{Extended_Pictographic}/u.test(g));
const DEFAULT_STATUS_EMOJIS = [...new Set(split(RAW))];
module.exports = { DEFAULT_STATUS_EMOJIS, split };
