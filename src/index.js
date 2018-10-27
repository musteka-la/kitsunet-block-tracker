'use strict'

const assert = require('assert')
const EventEmitter = require('events')
const hexUtils = require('./hex-utils')
const pify = require('pify')

const log = require('debug')('kitsunet:block-tracker')

const DEFAULT_TOPIC = 'kitsunet:block-header'

class BlockTracker extends EventEmitter {
  constructor ({ node, provider, topic, ethQuery }) {
    super()

    assert(node, `libp2p node is required`)

    this.node = node
    this.multicast = pify(this.node.multicast)
    this.ethProvider = provider
    this.ethQuery = ethQuery ? pify(ethQuery) : null
    this.topic = topic || DEFAULT_TOPIC
    this.started = false
    this.currentBlock = null
    this.blocks = new Map()
  }

  getCurrentBlock () {
    return this.currentBlock
  }

  async getLatestBlock () {
    if (this.currentBlock) return this.currentBlock
    return Promise(resolve => this.on('latest', resolve)
      .then(() => this.currentBlock))
  }

  async getBlockByNumber (blockNumber) {
    log(`latest block is: ${Number(blockNumber)}`)
    const cleanHex = hexUtils.formatHex(blockNumber)
    const block = await this.ethQuery.getBlockByNumber(cleanHex, false)
    this._publish(Buffer.from(JSON.stringify(block)))
  }

  _hook (peer, msg, cb) {
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
    return cb(null, msg)
  }

  async start () {
    if (!this.started) {
      this.multicast.addFrwdHooks(this.topic, [this._hook.bind(this)])
      await this.multicast.subscribe(this.topic, this._handler.bind(this))

      if (!this.ethProvider) {
        return log(`no eth provider, skipping block tracking from rpc`)
      }
      this.ethProvider.on('latest', this.getBlockByNumber.bind(this))
    }
  }

  async stop () {
    if (this.started) {
      await this.multicast.unsubscribe(this.topic, this._handler.bind(this))
      this.multicast.removeFrwdHooks(this.topic, [this._hook.bind(this)])
      if (!this.ethProvider) {
        return log(`no eth provider, skipping block tracking`)
      }
      this.ethProvider.removeListener('latest', this.getBlockByNumber.bind(this))
    }
  }

  _handler (msg) {
    const data = msg.data.toString()
    try {
      const block = JSON.parse(data)
      const number = this.currentBlock ? Number(this.currentBlock.number) : 0
      log(`got new block from pubsub ${number}`)
      if (Number(block.number) > number) {
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
    this.multicast.publish(this.topic, blockHeader, -1)
  }
}

module.exports = BlockTracker
