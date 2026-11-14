const { randomInt } = require('crypto');

const LETTERS = 'abcdefghjkmnpqrstuvwxyz';

function generateTemporaryPassword() {
  const letters = Array.from({ length: 12 }, () => LETTERS[randomInt(LETTERS.length)]).join('');
  return `${letters.slice(0, 4)}-${letters.slice(4, 8)}-${letters.slice(8)}`;
}

module.exports = { generateTemporaryPassword };
