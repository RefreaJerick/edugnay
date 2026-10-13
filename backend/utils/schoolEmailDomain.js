const BASE_DOMAIN = (process.env.SCHOOL_EMAIL_DOMAIN_BASE || 'academix.test').trim().toLowerCase();

function schoolDomainSlug(name) {
  const words = String(name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/highschool/gi, 'high school')
    .replace(/['’]/g, '')
    .toLowerCase().match(/[a-z0-9]+/g) || [];
  return (words.length > 1 ? words.map(word => word[0]).join('') : words[0] || 'school').slice(0, 40);
}

function schoolDomainCandidate(name, suffix = '') {
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(BASE_DOMAIN)) {
    throw new Error('SCHOOL_EMAIL_DOMAIN_BASE must be a valid domain suffix.');
  }
  const slug = schoolDomainSlug(name);
  return `${slug}${suffix ? `-${suffix}` : ''}.${BASE_DOMAIN}`;
}

module.exports = { schoolDomainCandidate, schoolDomainSlug };
