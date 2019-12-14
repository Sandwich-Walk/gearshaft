const createLog = require('../../test/test-log')
const { AssertionError } = require('assert')
const { exampleCategory, examplePutCategory, exampleStreamName } = require('../examples')

exports.generateGetCategorySuite = ({
  createMessageStore
}) => {
  let messageStore, log
  beforeEach(async () => {
    log = createLog()
    messageStore = createMessageStore({ log })
  })

  describe('get-category', () => {
    describe('given a stream name rather than category', () => {
      it('throws error', async () => {
        const streamName = exampleStreamName()

        const error = await messageStore.getCategory(streamName).catch(err => err)

        expect(error).toBeInstanceOf(AssertionError)
        expect(error.message).toBe(`stream category required, not a specific stream (${streamName})`)
      })
    })

    describe('category with no messages', () => {
      let category, results

      beforeEach(async () => {
        category = exampleCategory()
        results = await messageStore.getCategory(category)
      })

      it('returns empty array', async () => {
        expect(results).toEqual([])
      })

      it('logs success', () => {
        expect(log.info).toHaveBeenCalledWith({
          batchSize: expect.any(Number),
          count: 0,
          position: 0,
          streamName: category
        }, 'message-store get: successful')
      })
    })

    describe('category with multiple streams', () => {
      it('retrieves messages from all stream', async () => {
        const { category, messages } = await examplePutCategory(messageStore, { count: 3, trackMessages: true })

        const results = await messageStore.getCategory(category)

        expect(results.map(r => r.id)).toEqual(messages.map(m => m.id))
      })
    })

    describe('batch size', () => {
      describe('when not specified', () => {
        it('uses default value of 1000', async () => {
          await messageStore.getCategory(exampleCategory())

          expect(log.info).toHaveBeenCalledWith(expect.objectContaining({
            batchSize: 1000
          }), expect.anything())
        })
      })

      describe('store with an overriden batch size', () => {
        const A_BATCH_SIZE = 2
        beforeEach(() => {
          messageStore = createMessageStore({ log, batchSize: A_BATCH_SIZE })
        })

        it('limits the results to the batch size', async () => {
          const { category } = await examplePutCategory(messageStore, { count: 3 })
          const results = await messageStore.getCategory(category)
          expect(results.length).toBe(A_BATCH_SIZE)
        })
      })
    })

    describe('when called without await', () => {
      it('does not operate during the same tick of the event loop', () => {
        const category = exampleCategory()

        messageStore.getCategory(category)

        expect(log.info).not.toHaveBeenCalled()
      })
    })
  })
}