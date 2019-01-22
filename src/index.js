'use strict'

const assert = require('assert')
const EventEmitter = require('events')
const hexUtils = require('./hex-utils')
const pify = require('pify')

const LruCache = require('mnemonist/lru-cache')

const log = require('debug')('kitsunet:block-tracker')
const DEFAULT_TOPIC = 'kitsunet:block-header'

class BlockTracker extends EventEmitter {
  constructor ({ node, blockTracker, topic, ethQuery }) {
    super()

    assert(node, `libp2p node is required`)

    this.node = node
    this.multicast = pify(this.node.multicast)
    this.blockTracker = blockTracker
    this.ethQuery = ethQuery ? pify(ethQuery) : null
    this.topic = topic || DEFAULT_TOPIC
    this.started = false
    this.currentBlock = null
    this.oldBlock = null
    this.peerBlocks = new LruCache(1000)
    this.blocks = new LruCache(1000)

    this.hook = this._hook.bind(this)
    this.handler = this._handler.bind(this)
    this.publishBlockByNumberHandler = this.publishBlockByNumber.bind(this)
  }

  _handler (msg) {
    const data = msg.data.toString()
    try {
      const block = JSON.parse(data)
      log(`got new block from pubsub ${block.number}`)
      this.blocks.set(block.number, block)
      const number = this.currentBlock ? Number(this.currentBlock.number) : 0
      if (Number(block.number) > number) {
        this.oldBlock = this.currentBlock
        this.currentBlock = block
        this.emit('latest', this.currentBlock)
        this.emit('sync', { block, oldBlock: this.oldBlock })
        this.emit('block', this.currentBlock)
      }
    } catch (err) {
      log(err)
    }
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

    const peerId = peer.info.id.toB58String()
    const peerBlocks = this.peerBlocks.get(peer.info.id.toB58String()) || new LruCache(1000)
    if (!peerBlocks.has(block.number)) {
      this.peerBlocks.set(peerId, peerBlocks)
      peerBlocks.set(block.number, true)
      return cb(null, msg)
    }

    const skipMsg = `already forwarded to peer, skipping block ${block.number}`
    log(skipMsg)
    return cb(skipMsg)
  }

  getOldBlock () {
    return this.oldBlock
  }

  getCurrentBlock () {
    return this.currentBlock
  }

  async getLatestBlock () {
    if (this.currentBlock) return this.currentBlock
    await new Promise(resolve => this.once('latest', resolve))
    return this.currentBlock
  }

  async getBlockByNumber (blockNumber) {
    log(`latest block is: ${Number(blockNumber)}`)
    const cleanHex = hexUtils.formatHex(blockNumber)
    if (this.blocks.has(blockNumber)) {
      return this.blocks.get(blockNumber)
    }

    let block = null
    if (this.ethQuery) {
      block = await this.ethQuery.getBlockByNumber(cleanHex, false)
    }

    return block
  }

  async publishBlockByNumber (blockNumber) {
    const block = await this.getBlockByNumber(blockNumber)
    this._publish(Buffer.from(JSON.stringify(block)))
  }

  async start () {
    if (!this.started) {
      this.multicast.addFrwdHooks(this.topic, [this.hook])
      await this.multicast.subscribe(this.topic, this.handler)

      if (!this.blockTracker) {
        return log(`no eth provider, skipping block tracking from rpc`)
      }
      this.blockTracker.on('latest', this.publishBlockByNumberHandler)
    }
  }

  async stop () {
    if (this.started) {
      await this.multicast.unsubscribe(this.topic, this.handler)
      this.multicast.removeFrwdHooks(this.topic, [this.hook])
      if (!this.blockTracker) {
        return log(`no eth provider, skipping block tracking`)
      }
      this.blockTracker.removeListener('latest', this.publishBlockByNumberHandler)
    }
  }

  _publish (blockHeader) {
    this.multicast.publish(this.topic, blockHeader, -1)
  }
}

module.exports = BlockTracker
