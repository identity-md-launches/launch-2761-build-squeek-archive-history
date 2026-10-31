import test from 'node:test';
import assert from 'node:assert/strict';
import { SELECTORS, calldata, decodeAddress, decodeString, decodeUint, uintWord, word } from '../src/lib/abi.js';

test('renderSVG calldata matches the measured layout', () => {
  const data = calldata(
    SELECTORS.renderSVG,
    word('0x0677aCa34747cD8e60f988F75e2f89d5E00Bb27D'),
    word('0x722cd60a3d3e96a969adea9a7ae78b9b6dad188f4f04a59a26084d887a16d649'),
    uintWord(8936),
  );
  assert.equal(data.length, 10 + 64 * 3);
  assert.ok(data.startsWith('0x4e026d42000000000000000000000000' + '0677aca34747cd8e60f988f75e2f89d5e00bb27d'));
  assert.ok(data.endsWith('22e8'));
});

test('ownerOf calldata and address decoding', () => {
  assert.equal(calldata(SELECTORS.ownerOf, uintWord(1)), '0x6352211e' + '0'.repeat(63) + '1');
  assert.equal(decodeAddress('0x0000000000000000000000004b67b739dfd832f4eac67a7aa3bc244fb74cea4f'), '0x4b67b739dfd832f4eac67a7aa3bc244fb74cea4f');
  assert.equal(decodeUint('0x' + '0'.repeat(60) + '2703'), 9987n);
});

test('ABI dynamic string: offset, length, UTF-8 bytes', () => {
  const body = Buffer.from('<svg>ü</svg>', 'utf8');
  const hex = '0x' + uintWord(32) + uintWord(body.length) + body.toString('hex').padEnd(64, '0');
  assert.equal(decodeString(hex), '<svg>ü</svg>');
});

test('word rejects non-hex and oversize values', () => {
  assert.throws(() => word('0xzz'));
  assert.throws(() => word('0x' + '1'.repeat(65)));
});
