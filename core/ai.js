// The AI behind the "ai" and "chatbot" commands. Its name is NelsonFx.
// Works without any key through a free public service. With a Gemini key (setapi gemini <key>) the answers are better.
const store = require('../whatsapp/store');
const web = require('./web');

const NAME = 'NelsonFx';
const PERSONA =
  `You are ${NAME}, a friendly, helpful and witty assistant that chats on WhatsApp. ` +
  `If someone asks your name, say you are ${NAME}. Keep answers short and clear (under 120 words) unless the person asks for more. ` +
  `Write plain text; you may use WhatsApp formatting like *bold* and _italic_ but no markdown headings or tables. ` +
  `Reply in the language the person writes in. Never say which company or model is behind you. Be kind and never write anything harmful.`;

const shorten = (t, n) => String(t || '').replace(/\s+\n/g, '\n').trim().slice(0, n);

async function gemini(messages, key) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: PERSONA }] },
      contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: 600, temperature: 0.8 },
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Gemini answered ${res.status}`);
  const j = await res.json();
  const text = j?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('');
  if (!text) throw new Error('Gemini sent no answer');
  return text;
}

// free public service (no key): an OpenAI-style endpoint, then a plain text endpoint
async function free(messages) {
  try {
    const res = await fetch('https://text.pollinations.ai/openai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'openai', messages: [{ role: 'system', content: PERSONA }, ...messages], max_tokens: 600 }),
      signal: AbortSignal.timeout(30000),
    });
    if (res.ok) {
      const j = await res.json();
      const t = j?.choices?.[0]?.message?.content;
      if (t) return t;
    }
  } catch (err) {
    // the plain endpoint below
  }
  const last = messages[messages.length - 1]?.content || '';
  return web.getText(`https://text.pollinations.ai/${encodeURIComponent(last.slice(0, 1500))}?model=openai&system=${encodeURIComponent(PERSONA)}`, { timeout: 30000 });
}

// messages: [{ role: 'user' | 'assistant', content }]  ->  the answer text
async function chat(messages) {
  const clean = messages.map((m) => ({ role: m.role, content: shorten(m.content, 1500) })).filter((m) => m.content);
  if (!clean.length) throw new Error('empty question');
  const key = store.getApiKey('gemini');
  let text;
  if (key) {
    try {
      text = await gemini(clean, key);
    } catch (err) {
      console.log(`AI: Gemini failed (${err.message}), using the free service`);
    }
  }
  if (!text) text = await free(clean);
  text = shorten(text, 3500);
  if (!text) throw new Error('no answer');
  return text;
}

// one single instruction (summarize, grammar...)
const task = (instruction, text) => chat([{ role: 'user', content: `${instruction}\n\n${shorten(text, 3000)}` }]);

module.exports = { NAME, chat, task };
