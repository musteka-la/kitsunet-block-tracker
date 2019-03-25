'use strict'

const assert = require('assert')
const EE = require('events')
const promisify = require('promisify-this')
const headerFromRpc = require('ethereumjs-block/header-from-rpc')
const Header = require('ethereumjs-block').Header
const Cache = require('lru-cache')
const utils = require('ethereumjs-util')

const DEFAULT_BLOCK_TTL = 5

const createCache = (options = { max: 100, maxAge: DEFAULT_BLOCK_TTL }) => {
  return new Cache(options)
}

const log = require('debug')('kitsunet:block-tracker')
const DEFAULT_TOPIC = '/kitsunet/block-header'

class BlockTracker extends EE {
  constructor ({ node, blockTracker, topic, ethQuery }) {
    super()

    assert(node, `libp2p node is required`)

    this.node = node
    this.multicast = this.node.multicast
    this.blockTracker = blockTracker // rpc block tracker
    this.ethQuery = ethQuery ? promisify(ethQuery) : null
    this.topic = topic || DEFAULT_TOPIC
    this.started = false
    this.currentHeader = null
    this.oldHeader = null
    this.peerHeader = createCache()
    this.headers = createCache()

    this.hook = this._hook.bind(this)
    this.handler = this._handler.bind(this)
    this.publishBlockByNumber = this.publishBlockByNumber.bind(this)
  }

  _handler (msg) {
    try {
      const header = new Header(msg.data)
      const blockNumber = utils.bufferToInt(header.number)
      log(`got new block from pubsub ${blockNumber}`)
      this.headers.set(blockNumber, header)
      const number = this.currentHeader ? utils.bufferToInt(this.currentHeader.number) : 0
      if (blockNumber > number) {
        this.oldHeader = this.currentHeader
        this.currentHeader = header
        this.emit('latest', this.currentHeader)
        this.emit('sync', { block: header, oldBlock: this.oldHeader })
      }
      this.emit('block', this.currentHeader)
    } catch (err) {
      log(err)
    }
  }

  _hook (peer, msg, cb) {
    let header = null
    try {
      header = new Header(msg.data)
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
    return this.oldHeader.number
  }

  getCurrentBlock () {
    return this.currentHeader.number
  }

  async getLatestBlock () {
    if (this.currentHeader) return this.currentHeader.number
    await new Promise(resolve => this.once('latest', (block) => {
      log(`latest block is: ${Number(block)}`)
      resolve(block.number)
    }))
    return this.currentHeader.number
  }

  async getBlockByNumber (blockNumber) {
    const cleanHex = utils.addHexPrefix(blockNumber)
    if (this.headers.has(blockNumber)) {
      return this.headers.get(blockNumber)
    }

    let header = null
    if (this.ethQuery) {
      header = await this.ethQuery.getBlockByNumber(cleanHex, false)
      header = headerFromRpc(header)
    }

    return header
  }

  async publishBlockByNumber (blockNumber) {
    const header = await this.getBlockByNumber(blockNumber)
    this._publish(header.serialize())
  }

  async start () {
    if (!this.started) {
      this.multicast.addFrwdHooks(this.topic, [this.hook])
      await this.multicast.subscribe(this.topic, this.handler)

      if (!this.blockTracker) {
        return log(`no eth provider, skipping block tracking from rpc`)
      }
      this.blockTracker.on('latest', this.publishBlockByNumber)
    }
  }

  async stop () {
    if (this.started) {
      await this.multicast.unsubscribe(this.topic, this.handler)
      this.multicast.removeFrwdHooks(this.topic, [this.hook])
      if (!this.blockTracker) {
        return log(`no eth provider, skipping block tracking`)
      }
      this.blockTracker.removeListener('latest', this.publishBlockByNumber)
    }
  }

  _publish (blockHeader) {
    this.multicast.publish(this.topic, blockHeader, -1)
  }
}

module.exports = BlockTracker
