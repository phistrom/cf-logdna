declare global {
  interface Console {
    critical(...data: any[]): void;
  }

  interface FetchEvent {
    /**
     * A special version of the normal console object that can associate log
     * messages with this event. The regular console can too, but not as
     * reliably. You should try to use `event.console` whenever it's possible.
     */
    console: Console;

    /**
     * Date.now() of the event. Has to be redefined because it's normally
     * readonly and Cloudflare Workers does not implement it.
     */
    timeStamp: number;

    /**
     * The original, unmodified waitUntil function.
     * @param f
     */
    $waitUntil(f: any): void;
  }

  interface WorkerGlobalScope {
    /**
     * The original, unmodified addEventListener function.
     */
    //addEventListener<K extends keyof DedicatedWorkerGlobalScopeEventMap>(type: K, listener: (this: DedicatedWorkerGlobalScope, ev: DedicatedWorkerGlobalScopeEventMap[K]) => any, options?: boolean | AddEventListenerOptions): void;
    $addEventListener<K extends keyof CloudflareWorkerEventMap>(type: K, listener: (this: WorkerGlobalScope, ev: CloudflareWorkerEventMap[K]) => any, options?: boolean | AddEventListenerOptions): void;

    /**
     * The original console object that does not log to LogDNA.
     */
    $console: Console;

    /**
     * This should be passed in as a Cloudflare Worker Secret.
     * Make sure to run `wrangler secret put LOGDNA_KEY` before publishing.
     */
    readonly LOGDNA_KEY: string;

    /**
     * This should be an environment variable. Add it to your wrangler.toml with
     * a line like `vars = { WORKER_NAME = "my-cf-worker" }`
     * This gets used as the APP name when sending to LogDNA.
     */
    readonly WORKER_NAME: string;
    /**
     * If the LOG_COOKIES environment variables has ANY value, cookies WILL be
     * logged in the request.headers object. Otherwise, if left undefined, the
     * Cookie header will be deleted from the Request object (if it exists).
     */
    readonly LOG_COOKIES: string | undefined;

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
    readonly ORPHANED_TIME: number;
  }

}

/**
 * utils.convertErrorToObject() produces this object from an Error object to
 * make Errors JSON.stringify-able.
 */
export type ErrorObject = { name?: string, message?: string, stack?: string } & Record<string, any>


/**
 * For specifying the log level of a message.
 * - `console.debug("...")` uses DEBUG
 * - `console.log("...")` uses INFO
 * - `console.info("...")` uses INFO
 * - `console.warn("...")` uses WARN
 * - `console.error("...")` uses ERROR
 * - `console.critical("...")` is the same as critical.error,
 *     except it sets the level to CRITICAL for LogDNA
 */
export type Severity = "DEBUG" | "INFO" | "WARN" | "ERROR" | "CRITICAL"


/**
 * Remove the two large TLS objects. clientAcceptEncoding is removed
 * so it can be changed from a string to string[]
 */
type CFObjectBase = Omit<IncomingRequestCfProperties,
  "clientAcceptEncoding" | "tlsClientAuth" | "tlsExportedAuthenticator">


/**
 * Simplified version of the request.cf object.
 */
export interface CFObject extends CFObjectBase {
  clientAcceptEncoding: string[];
}

/**
 * named parameters for the getLogDNAURL() function
 */
export interface getLogDNAURLParameters {
  hostname?: string;
  ip?: string;
  tags?: string[];
}

interface CloudflareWorkerEventMap {
  "fetch": FetchEvent;
  "scheduled": ScheduledEvent;
}

/**
 * Expected JSON format for each line sent to LogDNA.
 */
export interface LogDNALine {
  app: string;
  level: Severity;
  line: string;
  meta: Record<string, any>;
  timestamp: number;
}

/**
 * The body of the JSON message to POST to LogDNA's ingest URL.
 */
export interface LogDNALines {
  lines: LogDNALine[];
}

/**
 * A stripped down Request object that can be passed into JSON.stringify
 */
export interface RequestObject {
  headers: Record<string, string>;
  method: string;
  redirect: RequestRedirect;
  url: string;
}

/**
 * A stripped down Response object that can be passed into JSON.stringify and
 * lacks any "body" functionality to avoid accidentally mutating or awaiting
 * any streams.
 */
export interface ResponseObject {
  headers: Record<string, string>;
  ok: boolean;
  redirected: boolean;
  status: number;
  statusText: string;
  // type: ResponseType;  // not implemented
  url: string;
}
