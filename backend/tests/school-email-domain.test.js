const assert = require('node:assert/strict');
const test = require('node:test');
const { schoolDomainCandidate } = require('../utils/schoolEmailDomain');

test('school domains use the name acronym and a collision suffix when needed', () => {
  assert.equal(schoolDomainCandidate('Mangaldan National High School'), 'mnhs.academix.test');
  assert.equal(schoolDomainCandidate('Mangaldan National Highschool', 'a1b2c3'), 'mnhs-a1b2c3.academix.test');
  assert.equal(schoolDomainCandidate("Saint Columban's College"), 'scc.academix.test');
});
