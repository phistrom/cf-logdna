/**
 * This is the REST API for LogDNA ingestion. It is used by getLogDNAURL as a
 * base, and then query parameters are added to it from there.
 */
export const LOGDNA_INGEST_URL = "https://logs.logdna.com/logs/ingest"

/**
 * The value of ORPHANED_TIME or the default the default value of 10 seconds.
 */
// @ts-ignore
self.ORPHANED_TIME = (self.ORPHANED_TIME === undefined) ? 10000 : parseInt(self.ORPHANED_TIME)

/**
 * When a batch is initiated, a Worker applies its timestamp to a Context's
 * `batched` field so other Workers won't attempt to send it. If the `batched`
 * timestamp is older than this many milliseconds, the responsible Worker must
 * have failed in some way to remove this old job. An orphaned job should be
 * treated as if the `batched` field for the Context was still `undefined`.
 *
 * Define in your wrangler.toml i.e. `vars = { ORPHANED_TIME = "20000" }`
 * The default is 10000ms (10 seconds).
 *
 */
export const ORPHANED_TIME = self.ORPHANED_TIME

/**
 * Number of milliseconds to wait after successfully sending Contexts to
 * LogDNA before deleting them. Any console messages logged in a waitUntil
 * promise will need the Context to get their associated request/response rays.
 * This timeout gives them a chance to resolve before the Context is deleted to
 * free up memory.
 */
export const DELETE_LOGGED_CONTEXTS_AFTER = 10000


/**
 * Number of milliseconds to delay logging after an event. This allows multiple
 * requests to be sent to LogDNA in a batch.
 */
export const DELAY_BEFORE_LOGGING_CONTEXT = 2000


/**
 * Number of milliseconds to wait after an unhandled exception occurs in an
 * `event.waitUntil` Promise before sending it to LogDNA. This allows
 * `event.respondWith` a chance to finish sending a response to the client so
 * that we can still properly log the request/response to LogDNA.
 */
export const DELAY_LOGGING_WAITUNTIL_EXCEPTION = 5000
