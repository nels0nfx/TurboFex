const QUESTIONS = [
  ['be able to fly', 'be able to turn invisible'], ['never use social media again', 'never watch another movie'],
  ['have unlimited money', 'have unlimited free time'], ['live without music', 'live without TV'],
  ['always be 10 minutes late', 'always be 20 minutes early'], ['be the funniest person in the room', 'be the smartest person in the room'],
  ['have a personal chef', 'have a personal driver'], ['explore space', 'explore the deep ocean'],
  ['speak every language', 'play every instrument'], ['live by the beach', 'live in the mountains'],
  ['never eat pizza again', 'never eat chocolate again'], ['have no homework or work for a year', 'get paid double for a year'],
  ['be famous', 'be rich but unknown'], ['only be able to whisper', 'only be able to shout'],
];

module.exports = {
  name: 'wyr',
  category: 'fun',
  description: 'Would you rather... get a random either/or question',
  async run({ reply }) {
    const [a, b] = QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)];
    await reply(`🤷 *Would you rather...*\n\n🅰️ ${a}\nor\n🅱️ ${b}?\n\nReply A or B!`);
  },
};
