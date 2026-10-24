import test from 'node:test'
import assert from 'node:assert/strict'
import { StateReplica, StateSyncError } from '../src/api/stateSync.ts'

test('snapshot replaces state and ordered patches update it', () => {
  const replica = new StateReplica()
  replica.replace({ version: 2, state: { Players: [{ Health: 20 }], 'a/b~c': null } })
  replica.apply({ kind: 'replaceValue', fromVersion: 2, toVersion: 2, path: '/a~1b~0c', value: 'visible' })
  replica.apply({ kind: 'insertListItem', fromVersion: 2, toVersion: 3, path: '/Players', index: 1, value: { Health: 10 } })
  replica.apply({ kind: 'moveListItem', fromVersion: 3, toVersion: 4, path: '/Players', fromIndex: 1, toIndex: 0 })
  assert.deepEqual(replica.snapshot, {
    version: 4, state: { Players: [{ Health: 10 }, { Health: 20 }], 'a/b~c': 'visible' },
  })
  replica.replace({ version: 0, state: { Players: [] } })
  assert.deepEqual(replica.snapshot, { version: 0, state: { Players: [] } })
})

test('invalid patches leave the replica untouched', () => {
  const replica = new StateReplica()
  replica.replace({ version: 1, state: { Players: [{ Health: 20 }] } })
  const patches = [
    { kind: 'replaceValue', fromVersion: 0, toVersion: 2, path: '/Players', value: [] },
    { kind: 'replaceValue', fromVersion: 1, toVersion: 2, path: '/Players/0/Health' },
    { kind: 'removeListItem', fromVersion: 1, toVersion: 2, path: '/Players', index: 1 },
    { kind: 'replaceValue', fromVersion: 1, toVersion: 2, path: '/Players/0/Unknown', value: 0 },
    { kind: 'unknown', fromVersion: 1, toVersion: 2, path: '/' },
  ]
  for (const patch of patches) {
    assert.throws(() => replica.apply(patch), StateSyncError)
    assert.deepEqual(replica.snapshot, { version: 1, state: { Players: [{ Health: 20 }] } })
  }
})

test('remaining list operations and root replacement follow the protocol', () => {
  const replica = new StateReplica()
  replica.replace({ version: 0, state: { Items: ['a', 'b'] } })
  replica.apply({ kind: 'replaceListItem', fromVersion: 0, toVersion: 1, path: '/Items', index: 0, value: null })
  replica.apply({ kind: 'removeListItem', fromVersion: 1, toVersion: 2, path: '/Items', index: 1 })
  assert.deepEqual(replica.snapshot.state.Items, [null])
  replica.apply({ kind: 'clearList', fromVersion: 2, toVersion: 3, path: '/Items' })
  replica.apply({ kind: 'replaceValue', fromVersion: 3, toVersion: 4, path: '/', value: { Other: true } })
  assert.deepEqual(replica.snapshot, { version: 4, state: { Other: true } })
})
