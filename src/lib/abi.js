// Hand-built calldata and return decoding for the few calls the archive makes.
// Every argument is one 32-byte word, left-padded; no web3 library.

/** Four-byte selectors, verified against the live contracts. */
export const SELECTORS = Object.freeze({
  art: '0x301bd28e', // art()
  collectionSeed: '0x5752a646', // collectionSeed()
  renderer: '0x8ada6b0f', // renderer()
  totalSupply: '0x18160ddd', // totalSupply()
  ownerOf: '0x6352211e', // ownerOf(uint256)
  renderSVG: '0x4e026d42', // renderSVG(address,bytes32,uint256)
});

/**
 * Left-pad a hex value (with or without 0x) to one 32-byte word.
 * @param {string} hex
 * @returns {string} 64 hex characters, no 0x
 */
export function word(hex) {
  const clean = hex.replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]*$/.test(clean) || clean.length > 64) throw new Error(`Not a 32-byte value: ${hex}`);
  return clean.padStart(64, '0');
}

/**
 * Encode an unsigned integer as one word.
 * @param {number | bigint | string} value
 */
export function uintWord(value) {
  const n = BigInt(value);
  if (n < 0n) throw new Error('Negative uint');
  return word(n.toString(16));
}

/**
 * Build calldata from a selector and pre-encoded words.
 * @param {string} selector
 * @param {string[]} words
 */
export function calldata(selector, ...words) {
  return selector + words.join('');
}

/** @param {string} hex */
function strip(hex) {
  const clean = (hex || '').replace(/^0x/i, '');
  if (clean.length % 2) throw new Error('Odd-length hex');
  return clean;
}

/**
 * Read the address in the last 20 bytes of the first return word.
 * @param {string} hex
 */
export function decodeAddress(hex) {
  const clean = strip(hex);
  if (clean.length < 64) throw new Error('Empty return data');
  return '0x' + clean.slice(24, 64);
}

/** @param {string} hex */
export function decodeBytes32(hex) {
  const clean = strip(hex);
  if (clean.length < 64) throw new Error('Empty return data');
  return '0x' + clean.slice(0, 64);
}

/** @param {string} hex */
export function decodeUint(hex) {
  const clean = strip(hex);
  if (clean.length < 64) throw new Error('Empty return data');
  return BigInt('0x' + clean.slice(0, 64));
}

/**
 * Decode an ABI dynamic string: offset word, then the length word at that
 * offset, then that many bytes of UTF-8.
 * @param {string} hex
 */
export function decodeString(hex) {
  const clean = strip(hex);
  const offset = Number(BigInt('0x' + clean.slice(0, 64)));
  const lenStart = offset * 2;
  const length = Number(BigInt('0x' + clean.slice(lenStart, lenStart + 64)));
  const dataStart = lenStart + 64;
  const dataHex = clean.slice(dataStart, dataStart + length * 2);
  if (dataHex.length !== length * 2) throw new Error('String shorter than its length word');
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = parseInt(dataHex.slice(i * 2, i * 2 + 2), 16);
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}
