const JOKES = [
  'Why don\'t scientists trust atoms? Because they make up everything!',
  'I told my computer I needed a break, and now it won\'t stop sending me vacation ads.',
  'Why did the scarecrow win an award? He was outstanding in his field.',
  'What do you call fake spaghetti? An impasta!',
  'Why did the bike fall over? It was two-tired.',
  'I only know 25 letters of the alphabet. I don\'t know y.',
  'Why can\'t you give Elsa a balloon? Because she will let it go.',
  'What did the ocean say to the beach? Nothing, it just waved.',
  'Why do bees have sticky hair? Because they use honeycombs.',
  'I used to hate facial hair, but then it grew on me.',
  'What do you call a sleeping bull? A bulldozer.',
  'Why did the math book look sad? It had too many problems.',
];

module.exports = {
  name: 'joke',
  category: 'fun',
  description: 'Tell a random joke',
  async run({ reply }) {
    await reply(`😂 ${JOKES[Math.floor(Math.random() * JOKES.length)]}`);
  },
};
