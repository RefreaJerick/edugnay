const { SF2 } = require('./sf2');
const { SF3 } = require('./sf3');
const { SF5 } = require('./sf5');

function range(startRow, endRow, startColumn, endColumn) {
  return { startRow, endRow, startColumn, endColumn };
}

function columnNumber(value) {
  return [...value.toUpperCase()].reduce((number, character) => number * 26 + character.charCodeAt(0) - 64, 0);
}

function addressParts(address) {
  const match = /^([A-Z]+)(\d+)$/i.exec(String(address || ''));
  return match ? { column: columnNumber(match[1]), row: Number(match[2]) } : null;
}

// Explicit input zones keep labels and formulas read-only; add each future form here.
const entries = {
  SF1: {
    addresses: ['F4', 'H4', 'N4', 'U4', 'F6', 'P6', 'U6', 'X6'],
    ranges: [range(10, 58, columnNumber('B'), columnNumber('AA')),
      range(61, 64, columnNumber('D'), columnNumber('I')),
      range(61, 64, columnNumber('N'), columnNumber('Q')),
      range(61, 64, columnNumber('S'), columnNumber('U')),
      range(59, 64, columnNumber('W'), columnNumber('AA'))]
  },
  SF2: {
    addresses: Object.values(SF2.headers),
    ranges: [range(11, 11, columnNumber('D'), columnNumber('AB')),
      range(13, 33, columnNumber('B'), columnNumber('AE')),
      range(34, 34, columnNumber('D'), columnNumber('AE')),
      range(35, 59, columnNumber('B'), columnNumber('AE')),
      range(60, 61, columnNumber('D'), columnNumber('AE')),
      range(63, 93, columnNumber('AB'), columnNumber('AJ'))]
  },
  SF3: {
    addresses: Object.values(SF3.headers),
    placeholderAddresses: ['D9', 'F9', 'H9', 'J9', 'L9', 'N9', 'P9', 'R9'],
    ranges: [range(9, 10, columnNumber('D'), columnNumber('S')),
      range(12, 35, columnNumber('B'), columnNumber('T')),
      range(36, 36, columnNumber('B'), columnNumber('T')),
      range(37, 59, columnNumber('B'), columnNumber('T')),
      range(60, 61, columnNumber('B'), columnNumber('T')),
      range(62, 66, columnNumber('R'), columnNumber('T'))]
  },
  SF5: {
    addresses: Object.values(SF5.headers),
    ranges: [range(13, 32, columnNumber('A'), columnNumber('K')),
      range(33, 33, columnNumber('A'), columnNumber('K')),
      range(34, 59, columnNumber('A'), columnNumber('K')),
      range(60, 60, columnNumber('A'), columnNumber('K')),
      range(15, 20, columnNumber('N'), columnNumber('P')),
      range(24, 33, columnNumber('N'), columnNumber('P')),
      range(35, 48, columnNumber('M'), columnNumber('P'))]
  }
};

function isFormEntryCell(formCode, address) {
  const definition = entries[formCode];
  if (!definition) return false;
  const normalized = String(address || '').toUpperCase();
  if (definition.addresses.includes(normalized)) return true;
  const match = /^([A-Z]+)(\d+)$/.exec(normalized);
  if (!match) return false;
  const column = columnNumber(match[1]);
  const row = Number(match[2]);
  return definition.ranges.some(area => row >= area.startRow && row <= area.endRow
    && column >= area.startColumn && column <= area.endColumn);
}

function isFormEntryPlaceholder(formCode, address) {
  return entries[formCode]?.placeholderAddresses?.includes(String(address || '').toUpperCase()) || false;
}

function getFormEntryType(formCode, address, cell) {
  const normalized = String(address || '').toUpperCase();
  const parts = addressParts(normalized);
  const dateFormat = String(cell.numFmt || '').toLowerCase();
  if (formCode === 'SF1') {
    if (/^B(?:1\d|[2-5]\d)$/.test(normalized)) return 'text';
    if (/^H(?:1\d|[2-5]\d)$/.test(normalized)) return 'date';
    if (/^I(?:1\d|[2-5]\d)$/.test(normalized) || /^[TU]6[1-4]$/.test(normalized)) return 'number';
  }
  if (formCode === 'SF2' && parts?.row === 11 && parts.column >= columnNumber('D') && parts.column <= columnNumber('AB')) return 'dateText';
  if (formCode === 'SF2' && parts && [34, 60, 61].includes(parts.row)
    && parts.column >= columnNumber('D') && parts.column <= columnNumber('AB')) return 'number';
  if (formCode === 'SF2' && parts && parts.row >= 65 && parts.row <= 84
    && parts.column >= columnNumber('AH') && parts.column <= columnNumber('AJ')) return 'number';
  if (formCode === 'SF5' && parts && parts.row >= 13 && parts.row <= 60
    && parts.column >= columnNumber('A') && parts.column <= columnNumber('K')) {
    return [33, 60].includes(parts.row) || parts.column === columnNumber('F') ? 'number' : 'text';
  }
  if (formCode === 'SF5' && parts && parts.column >= columnNumber('N') && parts.column <= columnNumber('P')
    && ((parts.row >= 15 && parts.row <= 20) || (parts.row >= 24 && parts.row <= 33))) return 'number';
  if (formCode === 'SF3' && parts && parts.row === 9
    && parts.column >= columnNumber('D') && parts.column <= columnNumber('S')) return 'text';
  if (formCode === 'SF3' && parts && parts.row >= 12 && parts.row <= 59 && parts.row !== 36
    && parts.column >= columnNumber('D') && parts.column <= columnNumber('S')) return 'dateText';

  if (/[dmy]/.test(dateFormat) && dateFormat !== 'general') return 'date';
  if (formCode === 'SF2' && parts && parts.column >= columnNumber('AC') && parts.column <= columnNumber('AD')
    && parts.row >= 13 && parts.row <= 61) return 'number';
  if (formCode === 'SF3' && parts && [36, 60, 61].includes(parts.row)
    && parts.column >= columnNumber('D') && parts.column <= columnNumber('S')) return 'number';
  if (dateFormat !== 'general' && /[0#?]/.test(dateFormat)) return 'number';
  return 'text';
}

module.exports = { getFormEntryType, isFormEntryCell, isFormEntryPlaceholder };
