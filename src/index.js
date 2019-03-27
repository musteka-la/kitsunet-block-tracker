'use strict'

const assert = require('assert')
const EE = require('events')
const Block = require('ethereumjs-block')
const Cache = require('lru-cache')
const utils = require('ethereumjs-util')

const DEFAULT_BLOCK_TTL = 1000 * 60 * 5 // 5 mins

const createCache = (options = { max: 100, maxAge: DEFAULT_BLOCK_TTL }) => {
  return new Cache(options)
}

const log = require('debug')('kitsunet:block-tracker')
const DEFAULT_TOPIC = '/kitsunet/block-header'

class BlockTracker extends EE {
  constructor ({ node, topic }) {
    super()

    assert(node, `libp2p node is required`)

    this.node = node
    this.multicast = this.node.multicast
    this.topic = topic || DEFAULT_TOPIC
    this.started = false
    this.currentBlock = null
    this.oldBlock = null
    this.peerHeader = createCache()
    this.blocks = createCache()

    this.hook = this._hook.bind(this)
    this.handler = this._handler.bind(this)
    this.publishBlockByNumber = this.publish.bind(this)
  }

  _handler (msg) {
    try {
      const block = new Block(msg.data)
      const header = block.header
      const blockNumber = utils.addHexPrefix(header.number.toString('hex'))
      log(`got new block from pubsub ${blockNumber}`)
      this.blocks.set(blockNumber, block)
      const number = this.currentBlock ? utils.bufferToInt(this.currentBlock.number) : 0
      if (utils.bufferToInt(header.number) > number) {
        this.oldBlock = this.currentBlock
        this.currentBlock = block
        this.emit('latest', this.currentBlock)
        this.emit('sync', { block: block, oldBlock: this.oldBlock })
      }
      this.emit('block', this.currentBlock)
    } catch (err) {
      log(err)
    }
  }

  _hook (peer, msg, cb) {
    let header = null
    try {
      header = (new Block(msg.data)).header
      if (!header) {
        return cb(new Error(`No block in message!`))
      }
    } catch (err) {
      log(err)
      return cb(err)
    }

    const peerId = peer.info.id.toB58String()
    const peerBlocks = this.peerHeader.get(peer.info.id.toB58String()) || createCache()
    const blockNumber = utils.bufferToInt(header.number)
    if (!peerBlocks.has(blockNumber)) {
      this.peerHeader.set(peerId, peerBlocks)
      peerBlocks.set(blockNumber, true)
      return cb(null, msg)
    }

    const skipMsg = `already forwarded to peer, skipping block ${header.number}`
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
    await new Promise(resolve => this.once('latest', (block) => {
      log(`latest block is: ${Number(block)}`)
      resolve(block.number)
    }))
    return this.currentBlock
  }

  async getBlockByNumber (blockNumber) {
    const cleanHex = utils.addHexPrefix(blockNumber)
    return this.blocks.get(cleanHex)
  }

  async publish (block) {
    this._publish(block.serialize())
  }

  async start () {
    if (!this.started) {
      this.multicast.addFrwdHooks(this.topic, [this.hook])
      await this.multicast.subscribe(this.topic, this.handler)
    }
  }

  async stop () {
    if (this.started) {
      await this.multicast.unsubscribe(this.topic, this.handler)
      this.multicast.removeFrwdHooks(this.topic, [this.hook])
    }
  }

  _publish (blockHeader) {
    this.multicast.publish(this.topic, blockHeader, -1)
  }
}

module.exports = BlockTracker
