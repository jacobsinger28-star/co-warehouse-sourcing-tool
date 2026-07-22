import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseLeaseRate, leaseRepRate } from '../leaseRate.mjs'

test('parseLeaseRate — whole dollars', () => {
  assert.equal(parseLeaseRate('American Business Centers Built in 1955 1,600 - 4,622 SF Industrial Spaces $19 SF/YR'), 19)
})

test('parseLeaseRate — cents', () => {
  assert.equal(parseLeaseRate('Built in 1982 35,020 SF Industrial Space $15.95 SF/YR'), 15.95)
  assert.equal(parseLeaseRate('Built in 1962 34,844 SF Industrial Space $12.00 SF/YR'), 12)
})

test('parseLeaseRate — range takes the low end (asking floor)', () => {
  assert.equal(parseLeaseRate('Suite mix $13.25 - $15.00 SF/YR'), 13.25)
  assert.equal(parseLeaseRate('Flex space $8.00 - $18.00 SF/YR'), 8)
  assert.equal(parseLeaseRate('Range $15.50 - $16.95 SF/YR'), 15.5)
})

test('parseLeaseRate — "from" ($N+)', () => {
  assert.equal(parseLeaseRate('Northpoint Distribution Center Built in 1961 5,578 - 147,590 SF Industrial Spaces $5+ SF/YR'), 5)
})

test('parseLeaseRate — Price Upon Request and missing → null', () => {
  assert.equal(parseLeaseRate('Built in 1961 50 - 33,650 SF Spaces Price Upon Request'), null)
  assert.equal(parseLeaseRate('Sara David Realty, Inc. Nashville Storage Center Built in 1968 10,000 - 150,000 SF'), null)
  assert.equal(parseLeaseRate(''), null)
  assert.equal(parseLeaseRate(null), null)
  assert.equal(parseLeaseRate(undefined), null)
})

test('parseLeaseRate — does not grab an unrelated dollar figure', () => {
  // no SF/YR anchor → not a rate
  assert.equal(parseLeaseRate('Sold 2019 for $1,200,000 · 40,000 SF Industrial'), null)
})

test('leaseRepRate — min asking across multiple listings', () => {
  const lease = {
    n: 3,
    listings: [
      { note: 'Space A $12.00 SF/YR' },
      { note: 'Space B $8.50 SF/YR' },
      { note: 'Space C Price Upon Request' },
    ],
  }
  assert.equal(leaseRepRate(lease), 8.5)
})

test('leaseRepRate — falls back to the top-level note when no listings array', () => {
  assert.equal(leaseRepRate({ note: 'Single space $11.00 SF/YR' }), 11)
})

test('leaseRepRate — undefined when nothing parses', () => {
  assert.equal(leaseRepRate({ listings: [{ note: 'Price Upon Request' }] }), undefined)
  assert.equal(leaseRepRate({ note: 'Contact broker' }), undefined)
  assert.equal(leaseRepRate(null), undefined)
})
