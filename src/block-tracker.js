'use strict'

const assert = require('assert')

const createEthProvider = require('../eth-provider')
const hexUtils = require('../eth-provider/hex-utils')

const log = require('debug')('kitsunet:block-tracker')

module.exports = function ({ node, trackerRpcUrl, handler }) {
  assert(node, `libp2p node is required`)
  assert(handler, `handler is required`)

  const blocks = new Map()
  const ethProvider = createEthProvider({ rpcUrl: trackerRpcUrl || 'https://mainnet.infura.io/' })

  if (!handler) {
    throw new Error(`handler not provided`)
  }

  let enabled = false

  node.multicast.subscribe('block-header', handler)

  const trackerCb = (blockNumber) => {
    log(`latest block is: ${Number(blockNumber)}`)
    const cleanHex = hexUtils.formatHex(blockNumber)
    ethProvider.ethQuery.getBlockByNumber(cleanHex, false, (err, block) => {
      if (err) {
        log(err)
        return
      }
      publish(Buffer.from(JSON.stringify(block)))
    })
  }

  function enable (enable) {
    if (enabled !== enable) {
      enabled = enable
      if (enabled) {
        ethProvider.blockTracker.on('latest', trackerCb)
      } else {
        ethProvider.blockTracker.removeListener('latest', trackerCb)
      }
    }
  }

  function publish (blockHeader) {
    node.multicast.publish('block-header', blockHeader, -1, (err) => {
      if (err) {
        log(err)
      }
    })
  }

  node.multicast.addFrwdHooks('block-header', [(peer, msg, cb) => {
    let block = null
    try {
      block = JSON.parse(msg.data.toString())
      if (!block) {
        return cb(new Error(`No block in message!`))
      }
    } catch (err) {
      log(err)
      return cb(err)
    }

    const peerBlocks = blocks.has(peer.info.id.toB58String()) || new Set()
    if (peerBlocks.has(block.number)) {
      const msg = `skipping block ${block.number}`
      log(msg)
      return cb(msg)
    }
    peerBlocks.add(block.number)
    return true
  }])

  return {
    enable
  }
}
