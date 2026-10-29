const DARES = [
  'Send a voice note singing the chorus of your favourite song.', 'Change your profile picture to a funny face for one hour.',
  'Write a short poem about the person above you in the member list.', 'Do 10 push-ups and send a video, or say "I did it" honestly.',
  'Send the 5th photo in your gallery (if it is safe to share!).', 'Talk in rhymes for the next 5 messages.',
  'Send a voice note doing your best animal impression.', 'Compliment every admin of this group.',
  'Type your next 3 messages using only emojis.', 'Tell the group your most unusual talent.',
  'Say the alphabet backwards as fast as you can in a voice note.', 'Set your status to "I love Mondays" for an hour.',
  'Describe your day using only movie titles.', 'Send a selfie making your silliest face.',
  'Pretend to be a news reporter and announce what you had for lunch.', 'Tell a joke. If nobody laughs, tell another.',
  'Speak in a funny accent for your next voice note.', 'Draw something with your finger and send a screenshot.',
  'Say something nice about each of the last 3 people who sent messages.', 'Dance for 20 seconds and tell us how it went.',
];

module.exports = {
  name: 'dare',
  category: 'fun',
  description: 'Get a random dare for a party game',
  async run({ reply }) {
    await reply(`😈 *Dare*\n${DARES[Math.floor(Math.random() * DARES.length)]}`);
  },
};
