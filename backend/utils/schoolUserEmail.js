const ROLE_SUFFIX = { school_admin: 'adm', teacher: 'fac', student: 'stud', parent: 'par' };

function schoolEmailBase(firstName, lastName, role) {
  const clean = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
  const first = clean(firstName);
  const last = clean(lastName);
  if (!first || !last || !ROLE_SUFFIX[role]) {
    const error = new Error('Provide a supported role and a first and last name using letters or numbers.');
    error.status = 400;
    throw error;
  }
  return `${first[0]}.${last}.${ROLE_SUFFIX[role]}`;
}

function storedSchoolDomain(school) {
  const domain = String(school?.schoolEmailDomain || '').trim().toLowerCase();
  if (!domain) {
    const error = new Error('School email domain is not configured. Contact the platform administrator.');
    error.status = 503;
    throw error;
  }
  return domain;
}

function schoolEmailCandidate(base, domain, number = 1) {
  return `${base}${number === 1 ? '' : number}@${domain}`;
}

module.exports = { schoolEmailBase, schoolEmailCandidate, storedSchoolDomain };
