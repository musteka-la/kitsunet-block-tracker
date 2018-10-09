'use strict'

const assert = require('assert')
const EventEmitter = require('events')
const hexUtils = require('./hex-utils')

const log = require('debug')('kitsunet:block-tracker')

const DEFAULT_TOPIC = 'kitsunet:block-header'

class Tracker extends EventEmitter {
  constructor ({ node, ethProvider, topic }) {
    super()

    assert(node, `libp2p node is required`)
    assert(ethProvider, `ethProvider is required`)

    this.node = node
    this.ethProvider = ethProvider
    this.topic = topic || DEFAULT_TOPIC
    this.enabled = false

    const blocks = new Map()

    this.node.multicast.addFrwdHooks(topic, [(peer, msg, cb) => {
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

    this.node.multicast.on(topic, (header) => {
      this.emit(topic, header)
    })
  }

  getBlockByNumber (blockNumber) {
    log(`latest block is: ${Number(blockNumber)}`)
    const cleanHex = hexUtils.formatHex(blockNumber)
    this.ethProvider.ethQuery.getBlockByNumber(cleanHex, false, (err, block) => {
      if (err) {
        log(err)
        return
      }
      this.publish(Buffer.from(JSON.stringify(block)))
    })
  }

  enable (enable) {
    if (this.enabled !== enable) {
      this.enabled = enable
      const getBlockByNumber = this.getBlockByNumber.bind(this)
      if (this.enabled) {
        this.ethProvider.blockTracker.on('latest', getBlockByNumber)
      } else {
        this.ethProvider.blockTracker.removeListener('latest', getBlockByNumber)
      }
    }
  }

  publish (blockHeader) {
    this.node.multicast.publish(this.topic, blockHeader, -1, (err) => {
      if (err) {
        log(err)
      }
    })
  }
}

module.exports = Tracker
