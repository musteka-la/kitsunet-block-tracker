## An Ethereum block tracker over libp2p pubsub

> This module tracks the latest Ethereum block header using an RPC endpoint and retransmits it over a libp2p pubsub topic. The default topic is `kitsunet:block-header`, but any other string can be specified.

### Ussage

```js
const Tracker = require('kitsunet-block-tracker')

const node = // create libp2p node
const ethProvider = // create eth provider

const blockTracker = new BlockTracker({ node, ethProvider , topic: 'my-awesome-app:block'})
```

### Api

- `blockTrackerFactory(options)` - create the block tracker. Returns an object that exposes the `enable()` method.
  - `options`
    - `node` - a libp2p node that exposes a `multicast` object that implements the multicast [api](https://github.com/MetaMask/js-libp2p-multicast-experiment/blob/master/src/api.js)
    - `ethProvider` - An instance of [eth-block-tracker](https://github.com/MetaMask/eth-block-tracker)
    - `topic` (optional, defaults to `kitsunet:block-header`) - the pubsub topic to publish the block on

- `blockTracker.enable(Boolean)` - enable or disable block tracking.
  - By default the tracker will listen for blocks transmitted over the libp2p pubsub system, but will not poll for blocks from the provided RPC. This allows tracking block headers transmitted by others over pubsub, if tracking from the RCP endpoint is required, it can be enabled with this method.

- `blockTracker.onBlock(function)` - handler called on each new block
