const assert = require('node:assert/strict');
const test = require('node:test');
const { getSchoolLogoUrl, saveSchoolLogo } = require('../config/schoolLogos');

test('school logo URLs only expose stored image paths', () => {
  assert.equal(getSchoolLogoUrl({ id: 2, logoPath: '/assets/images/manghi-logo.jpg' }), '/api/schools/2/logo');
  assert.equal(getSchoolLogoUrl({ id: 2, logoPath: '123e4567-e89b-12d3-a456-426614174000.png' }), '/api/schools/2/logo');
  assert.equal(getSchoolLogoUrl({ id: 2, logoPath: '/assets/images/..' }), null);
  assert.equal(getSchoolLogoUrl({ id: 2, logoPath: 'https://example.com/tracker.png' }), null);
});

test('school logo upload rejects files whose bytes do not match their image type', async () => {
  await assert.rejects(
    saveSchoolLogo({ mimetype: 'image/png', buffer: Buffer.from('not a PNG file') }),
    error => error.status === 400
  );
});
