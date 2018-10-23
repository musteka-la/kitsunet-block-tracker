'use strict'

const assert = require('assert')
const EventEmitter = require('events')
const hexUtils = require('./hex-utils')

const log = require('debug')('kitsunet:block-tracker')

const DEFAULT_TOPIC = 'kitsunet:block-header'

class BlockTracker extends EventEmitter {
  constructor ({ node, ethProvider, topic }) {
    super()

    assert(node, `libp2p node is required`)

    this.node = node
    this.ethProvider = ethProvider
    this.topic = topic || DEFAULT_TOPIC
    this.started = false
    this.currentBlock = null
    this.blocks = new Map()

    this.node.multicast.addFrwdHooks(this.topic, [(peer, msg, cb) => {
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

      const peerBlocks = this.blocks.has(peer.info.id.toB58String()) || new Set()
      if (peerBlocks.has(block.number)) {
        const msg = `already forwarded to peer, skipping block ${block.number}`
        log(msg)
        return cb(msg)
      }
      peerBlocks.add(block.number)
      return true
    }])
  }

  getCurrentBlock () {
    return this.currentBlock
  }

  async getLatestBlock () {
    if (this.currentBlock) return this.currentBlock
    return Promise(resolve => this.on('latest', resolve)
      .then(() => this.currentBlock))
  }

  getBlockByNumber (blockNumber) {
    log(`latest block is: ${Number(blockNumber)}`)
    const cleanHex = hexUtils.formatHex(blockNumber)
    this.ethProvider.ethQuery.getBlockByNumber(cleanHex, false, (err, block) => {
      if (err) {
        log(err)
        return
      }
      this._publish(Buffer.from(JSON.stringify(block)))
    })
  }

  start () {
    if (!this.started) {
      this.node.multicast.subscribe(this.topic, this._handler.bind(this), () => { })

      if (!this.ethProvider) {
        return log(`no eth provider, skipping block tracking`)
      }
      this.ethProvider.blockTracker.on('latest', this.getBlockByNumber.bind(this))
    }
  }

  stop () {
    if (this.started) {
      this.node.multicast.unsubscribe(this.topic, this._handler.bind(this), () => {})
      if (!this.ethProvider) {
        return log(`no eth provider, skipping block tracking`)
      }

      this.ethProvider.blockTracker.removeListener('latest', this.getBlockByNumber.bind(this))
    }
  }

  _handler (msg) {
    const data = msg.data.toString()
    try {
      const block = JSON.parse(data)
      if (Number(block.number) > this.currentBlock) {
        const oldBlock = this.currentBlock
        this.currentBlock = block
        this.emit('latest', this.currentBlock)
        this.emit('sync', { block, oldBlock })
        this.emit('block', this.currentBlock)
      }
    } catch (err) {
      log(err)
    }
  }

  _publish (blockHeader) {
    this.node.multicast.publish(this.topic, blockHeader, -1, (err) => {
      if (err) {
        log(err)
      }
    })
  }
}

module.exports = BlockTracker
