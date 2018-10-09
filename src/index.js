'use strict'

const assert = require('assert')
const hexUtils = require('./hex-utils')
const log = require('debug')('kitsunet:block-tracker')

const DEFAULT_TOPIC = 'kitsunet:block-header'

module.exports = function ({ node, ethProvider, topic, handler }) {
  assert(node, `libp2p node is required`)
  assert(handler, `handler is required`)

  topic = topic || DEFAULT_TOPIC

  const blocks = new Map()

  if (!handler) {
    throw new Error(`handler not provided`)
  }

  let enabled = false

  node.multicast.on(topic, handler)

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
    node.multicast.publish(topic, blockHeader, -1, (err) => {
      if (err) {
        log(err)
      }
    })
  }

  node.multicast.addFrwdHooks(topic, [(peer, msg, cb) => {
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
      const msg = `already forwarded to peer, skipping block ${block.number}`
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
