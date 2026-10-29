const TRUTHS = [
  "What is the most embarrassing thing you've ever done?", 'What is a secret talent nobody here knows about?',
  'Who was your first crush?', "What's the silliest thing you're afraid of?", 'What is the worst gift you have ever received?',
  'What is your most-used emoji, and why?', "What's a lie you told that got out of hand?", 'What is the weirdest food you like?',
  'Which song do you secretly love but never admit to?', 'What would you do with a million rand/dollars tomorrow?',
  'What is the longest you have gone without a shower?', 'What is your biggest pet peeve?',
  'Who in this group would you trust with your phone for an hour?', "What's the last thing you searched online?",
  'What is one thing you wish you could change about yourself?', "What's your most useless skill?",
  'If you could swap lives with anyone here for a day, who?', 'What is the most childish thing you still do?',
  'What was your worst haircut?', 'What is the nicest thing someone did for you?',
];

module.exports = {
  name: 'truth',
  category: 'fun',
  description: 'Get a random truth question for a party game',
  async run({ reply }) {
    await reply(`🫣 *Truth*\n${TRUTHS[Math.floor(Math.random() * TRUTHS.length)]}`);
  },
};
