'use strict'

const HttpProvider = require('ethjs-provider-http')
const PollingBlockTracker = require('eth-block-tracker')
const EthQuery = require('eth-query')

module.exports = createEthProvider

function createEthProvider ({ rpcUrl }) {
  const provider = new HttpProvider(rpcUrl)
  const blockTracker = new PollingBlockTracker({ provider })
  const ethQuery = new EthQuery(provider)
  return { blockTracker, ethQuery }
}
