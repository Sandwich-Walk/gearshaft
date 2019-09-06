const operationError = require('../errors/operation-error')
const delay = require('util').promisify(setTimeout)
const { createConsumerHandlerRegistry } = require('./consumer-handler-registry')
const { createPositionStore } = require('./position-store')
const { createRunner } = require('../runner')

exports.createConsumer = ({
  log,
  name,
  positionUpdateInterval = 100,
  registerHandlers,
  store,
  streamName,
  strict = false,

  // TUNING
  highWaterMark = 500,
  lowWaterMark = 50,
  pollingIntervalMs = 100
}) => {
  const consumerError = operationError(`${name} consumer`)

  const positionStore = createPositionStore({ store, streamName })
  let positionUpdateCount = 0

  const registry = createConsumerHandlerRegistry({ name, log, strict })
  registerHandlers(registry.register)

  const getLogMeta = (messageData) => {
    return {
      streamName,
      position: messageData.position,
      globalPosition: messageData.globalPosition,
      type: messageData.type
    }
  }

  const dispatch = async (messageData) => {
    const meta = getLogMeta(messageData)

    try {
      await registry.handle(messageData)

      await updatePosition(messageData.globalPosition)
    } catch (err) {
      log.error({ ...meta, err }, err.message)
      throw err
    }

    log.debug(meta, `${name} consumer: ${messageData.type} message dispatched to handlers`)
  }

  const updatePosition = async (globalPosition) => {
    positionUpdateCount++
    if (positionUpdateCount >= positionUpdateInterval) {
      try {
        await positionStore.put(globalPosition)
      } catch (inner) {
        throw consumerError('error updating consumer position', inner)
      }

      positionUpdateCount = 0
    }
  }

  const start = () => {
    let state = 'filling' // filling | draining | waitForMessages
    let nextVersion = 0
    let queue = []

    // --- BATCH FETCHING ----
    const getBatch = async (version) => {
      const batch = await store.get(streamName, version)

      if (batch.length) {
        runner.trigger('batch', batch)
      } else {
        runner.trigger('waitToGetBatch', version)
      }
    }

    const waitToGetBatch = async (version) => {
      await delay(pollingIntervalMs)
      runner.trigger('getBatch', version)
    }

    // --- CONSUMPTION ----

    const processMessage = async () => {
      const messageData = queue.shift()
      try {
        await dispatch(messageData)
      } catch (e) {
        log.warn(getLogMeta(messageData), `${name} consumer: processing paused due to error (errorStrategy = "pause")`)
        runner.pause()
        queue.unshift(messageData) // place back in queue for retry if unpaused
      }

      if (state === 'draining' && queue.length < lowWaterMark) {
        fill()
      }

      if (queue.length) {
        runner.trigger('processMessage')
      } else {
        state = 'waitForMessages'
      }
    }

    const batch = (batch) => {
      queue = queue.concat(batch)

      nextVersion = queue[queue.length - 1].globalPosition + 1

      const waiting = state === 'waitForMessages'

      if (queue.length < highWaterMark) {
        fill()
      } else {
        state = 'draining'
      }

      if (waiting) {
        runner.trigger('processMessage')
      }
    }

    const fill = () => {
      state = 'filling'
      runner.trigger('getBatch', nextVersion)
    }

    const tasks = { batch, fill, getBatch, waitToGetBatch, processMessage }
    const runner = createRunner({ tasks })

    fill()
    state = 'waitForMessages'

    return runner
  }

  return { dispatch, positionStore, start }
}
