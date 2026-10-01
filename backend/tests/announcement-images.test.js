const assert = require('node:assert/strict');
const test = require('node:test');
const { imageType } = require('../config/announcementImages');

test('announcement images require matching file bytes and MIME type', () => {
  const png = { mimetype: 'image/png', buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) };
  assert.equal(imageType(png).extension, '.png');
  assert.throws(() => imageType({ ...png, mimetype: 'image/jpeg' }), /not valid/);
  assert.throws(() => imageType({ mimetype: 'image/png', buffer: Buffer.from('<svg></svg>') }), /not valid/);
});
