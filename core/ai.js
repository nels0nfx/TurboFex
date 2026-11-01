// The AI behind the "ai" and "chatbot" commands. Its name is NelsonFx.
// It tries these services in this order and uses the first one that answers. If a service has not answered after a few
// seconds, the next one is started at the same time (the fastest answer wins), so one slow service never keeps a person waiting:
//   1. Gemini     (free key from aistudio.google.com/apikey:  setapi gemini <key>)
//   2. Groq       (free key from console.groq.com/keys:       setapi groq <key>)
//   3. Pollinations (free key from enter.pollinations.ai:     setapi pollinations <key>)
//   4. the old key-free Pollinations address (it may not work any more)
// Free services retire their models often, so every service has a list of models and the bot tries them one by one.
const store = require('../whatsapp/store');
const web = require('./web');

const NAME = 'NelsonFx';
const PERSONA =
  `You are ${NAME}, a friendly, helpful and witty assistant that chats on WhatsApp. ` +
  `If someone asks your name, say you are ${NAME}. Keep answers short and clear (under 120 words) unless the person asks for more. ` +
  `Write plain text; you may use WhatsApp formatting like *bold* and _italic_ but no markdown headings or tables. ` +
  `Reply in the language the person writes in. Never say which company or model is behind you. Be kind and never write anything harmful.`;

const shorten = (t, n) => String(t || '').replace(/\s+\n/g, '\n').trim().slice(0, n);
// some models write their thinking between <think> tags: that is not part of the answer
const stripThinking = (t) => String(t || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
const uniq = (list) => list.filter((x, i) => x && list.indexOf(x) === i);

// models to try, newest first. The one that worked last time is tried first.
const MODELS = {
  gemini: () => uniq([process.env.GEMINI_MODEL, 'gemini-flash-latest', 'gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']),
  groq: () => uniq([process.env.GROQ_MODEL, 'openai/gpt-oss-120b', 'qwen/qwen3.6-27b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant']),
  pollinations: () => uniq([process.env.POLLINATIONS_MODEL, 'openai', 'openai-fast']),
};
const worked = {}; // service -> the model that answered last

const orderModels = (service) => {
  const list = MODELS[service]();
  return worked[service] && list.includes(worked[service]) ? [worked[service], ...list.filter((m) => m !== worked[service])] : list;
};

// one POST with a time limit. Errors say the status and the reason the service gave (never the key).
async function post(url, headers, body, timeout = 14000) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  const raw = await res.text();
  let json = null;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    json = null;
  }
  if (!res.ok) {
    const why = json?.error?.message || (typeof json?.error === 'string' ? json.error : '') || json?.message || raw;
    throw Object.assign(new Error(`${res.status} ${shorten(why, 110)}`), { status: res.status });
  }
  return json;
}

// tries the models of one service one by one; stops early when the key itself is refused
async function viaModels(service, call) {
  const problems = [];
  for (const model of orderModels(service)) {
    try {
      const text = stripThinking(await call(model));
      if (!text) throw new Error('empty answer');
      worked[service] = model;
      return { text, model };
    } catch (err) {
      problems.push(`${model}: ${err.message}`);
      const keyRefused = err.status === 401 || err.status === 403 || (err.status === 400 && /api key|apikey|credential/i.test(err.message));
      if (keyRefused) break; // another model will not help
    }
  }
  throw new Error(problems.slice(0, 3).join('; ') || 'no answer');
}

// Gemini "thinks" before it answers, which can take 5 to 20 seconds and eats the answer's space. A chat reply does not need
// it, so thinking is switched off. Every model family names the switch differently: the settings are tried one by one, and the one
// a model accepts is remembered (a model that refuses a setting answers with a 400 that mentions "thinking").
const thinkTries = (model) => {
  if (/gemini-3|flash-latest/.test(model)) return [{ thinkingLevel: 'minimal' }, { thinkingBudget: 0 }, null];
  if (/2\.5-(flash|flash-lite)$/.test(model)) return [{ thinkingBudget: 0 }, null];
  return [null];
};
const thinkPick = {}; // model -> position in its list that worked

const gemini = (messages, key) =>
  viaModels('gemini', async (model) => {
    const tries = thinkTries(model);
    let lastErr;
    for (let n = thinkPick[model] || 0; n < tries.length; n++) {
      const thinking = tries[n];
      try {
        const j = await post(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          { 'x-goog-api-key': key },
          {
            systemInstruction: { parts: [{ text: PERSONA }] },
            contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
            generationConfig: { maxOutputTokens: thinking ? 600 : 1500, temperature: 0.8, ...(thinking ? { thinkingConfig: thinking } : {}) },
          }
        );
        thinkPick[model] = n;
        const parts = j?.candidates?.[0]?.content?.parts || [];
        return parts.filter((p) => !p.thought).map((p) => p.text || '').join('');
      } catch (err) {
        lastErr = err;
        if (!(err.status === 400 && /think/i.test(err.message)) || n === tries.length - 1) throw err; // only a refused thinking setting moves on to the next setting
      }
    }
    throw lastErr;
  });

// Groq and Pollinations both speak the "OpenAI" way
// (reasoning models are asked to think very little: a chat reply does not need more, and it is much faster)
const reasoningTries = (service, model) => {
  if (service !== 'groq') return [{}];
  if (/gpt-oss/.test(model)) return [{ reasoning_effort: 'low' }, {}];
  if (/qwen3/.test(model)) return [{ reasoning_effort: 'none' }, {}];
  return [{}];
};
const openaiStyle = (service, url, key, messages) =>
  viaModels(service, async (model) => {
    const tries = reasoningTries(service, model);
    let lastErr;
    for (let n = 0; n < tries.length; n++) {
      try {
        const j = await post(url, key ? { Authorization: `Bearer ${key}` } : {}, { model, messages: [{ role: 'system', content: PERSONA }, ...messages], max_tokens: 700, temperature: 0.8, ...tries[n] });
        return j?.choices?.[0]?.message?.content || '';
      } catch (err) {
        lastErr = err;
        if (!(err.status === 400 && /reason/i.test(err.message)) || n === tries.length - 1) throw err;
      }
    }
    throw lastErr;
  });

// the old address that needed no key (kept as the very last try)
async function legacy(messages) {
  const problems = [];
  try {
    const j = await post('https://text.pollinations.ai/openai', {}, { model: 'openai', messages: [{ role: 'system', content: PERSONA }, ...messages], max_tokens: 600 }, 15000);
    const t = stripThinking(j?.choices?.[0]?.message?.content);
    if (t) return { text: t, model: 'openai' };
    problems.push('empty answer');
  } catch (err) {
    problems.push(err.message);
  }
  try {
    const last = messages[messages.length - 1]?.content || '';
    const t = stripThinking(await web.getText(`https://text.pollinations.ai/${encodeURIComponent(last.slice(0, 1500))}?model=openai&system=${encodeURIComponent(PERSONA)}`, { timeout: 15000 }));
    if (t) return { text: t, model: 'openai' };
    problems.push('empty answer');
  } catch (err) {
    problems.push(err.message);
  }
  throw new Error(problems.join('; '));
}

// the services that can be tried right now
function services() {
  const list = [];
  const g = store.getApiKey('gemini');
  const q = store.getApiKey('groq');
  const p = store.getApiKey('pollinations');
  if (g) list.push({ id: 'Gemini', run: (m) => gemini(m, g) });
  if (q) list.push({ id: 'Groq', run: (m) => openaiStyle('groq', 'https://api.groq.com/openai/v1/chat/completions', q, m) });
  if (p) list.push({ id: 'Pollinations', run: (m) => openaiStyle('pollinations', 'https://gen.pollinations.ai/v1/chat/completions', p, m) });
  list.push({ id: 'Free service', run: legacy, keyless: true });
  return list;
}

let lastUsed = null; // { service, model } of the last good answer

const timing = { hedge: 6000, giveUp: 32000 }; // milliseconds. hedge: a service that has not answered after this long gets company (the next one starts too). giveUp: nobody waits longer than this (tests make them tiny)

// messages: [{ role: 'user' | 'assistant', content }]  ->  the answer text
// The services start one after the other; the next one starts when the one before it FAILS or has been quiet for HEDGE_MS.
// The first good answer wins.
async function chat(messages) {
  const clean = messages.map((m) => ({ role: m.role, content: shorten(m.content, 1500) })).filter((m) => m.content);
  if (!clean.length) throw new Error('empty question');
  const list = services();
  const problems = [];

  const answer = await new Promise((resolve, reject) => {
    let next = 0;
    let finished = 0;
    let settled = false;
    const timers = [];
    const end = (fn, value) => {
      if (settled) return;
      settled = true;
      timers.forEach(clearTimeout);
      fn(value);
    };
    const launch = () => {
      if (settled || next >= list.length) return;
      const s = list[next++];
      const hedge = setTimeout(launch, timing.hedge);
      timers.push(hedge);
      Promise.resolve()
        .then(() => s.run(clean))
        .then((r) => {
          const text = shorten(r.text, 3500);
          if (!text) throw new Error('empty answer');
          lastUsed = { service: s.id, model: r.model };
          end(resolve, text);
        })
        .catch((err) => {
          clearTimeout(hedge);
          problems.push(`${s.id}: ${err.message}`);
          console.log(`AI: ${s.id} failed (${shorten(err.message, 140)})`);
          finished += 1;
          if (finished >= list.length) end(reject, null);
          else launch(); // do not wait for the timer: start the next service now
        });
    };
    timers.push(setTimeout(() => end(reject, null), timing.giveUp));
    launch();
  }).catch((e) => {
    if (e) throw e;
    return null;
  });

  if (answer) return answer;
  const hasKey = list.some((s) => !s.keyless);
  throw Object.assign(new Error(`${problems.join(' | ') || 'no answer in time'}${hasKey ? '' : ' | No AI key is set'}`), { noKey: !hasKey });
}

// one single instruction (summarize, grammar...)
const task = (instruction, text) => chat([{ role: 'user', content: `${instruction}\n\n${shorten(text, 3000)}` }]);

// "chatbot test": asks every available service a tiny question and says what happened (for the owner)
async function diagnose() {
  const out = [];
  const ask = [{ role: 'user', content: 'Reply with the single word OK.' }];
  for (const s of services()) {
    const t0 = Date.now();
    try {
      const r = await s.run(ask);
      out.push({ service: s.id, ok: true, model: r.model, ms: Date.now() - t0 });
    } catch (err) {
      out.push({ service: s.id, ok: false, error: shorten(err.message, 200), ms: Date.now() - t0 });
    }
  }
  return out;
}

const status = () => ({ lastUsed, keys: { gemini: !!store.getApiKey('gemini'), groq: !!store.getApiKey('groq'), pollinations: !!store.getApiKey('pollinations') } });

module.exports = { NAME, chat, task, diagnose, status, MODELS, timing };
