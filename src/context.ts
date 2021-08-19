import { CFObject, LogDNALine, RequestObject, ResponseObject } from "./types"
import { Loggable } from "./loggable"
import { getCommonLogFormatTimestamp, timeout } from "./utils"
import { DELETE_LOGGED_CONTEXTS_AFTER } from "./constants"

export class Context extends Loggable {
  public readonly cf: CFObject
  public readonly request: RequestObject
  public readonly response: ResponseObject | undefined
  public readonly timestamp: number

  private static readonly contexts = new Map<number, Context>()

  constructor(requestObj: RequestObject, cf: CFObject, respObj: ResponseObject | undefined, timestamp: number) {
    super()
    this.request = requestObj
    this.cf = cf
    this.response = respObj
    this.timestamp = timestamp

    self.$console.log(`New context @ ${timestamp} with '${this.requestRay}' and '${this.responseRay}' rays.`)
  }

  /**
   * Gets this Context in Common Log Format like Apache. This will be used to
   * summarize the log line in LogDNA (but then you can expand it to see all
   * the extra information that got logged).
   */
  get message(): string {
    const reqHeaders = this.request.headers,
      ip = reqHeaders["cf-connecting-ip"],
      user = reqHeaders["cf-access-authenticated-user-email"] || "-",
      timestamp = getCommonLogFormatTimestamp(),
      { method } = this.request,
      { pathname } = new URL(this.request.url),
      { httpProtocol } = this.cf,
      status = this.response?.status || "-",
      contentLength = this.response?.headers["content-length"] || "-"


    const message = `${ip} - ${user} [${timestamp}] "${method} ${pathname} ${httpProtocol}" ${status} ${contentLength}`
    return message
  }

  get requestRay(): string | undefined {
    return this.request.headers["cf-ray"]
  }

  get responseRay(): string | undefined {
    return this.response?.headers["cf-ray"]
  }

  /**
   * Get all unclaimed/orphaned Contexts, claim them, and return their
   * LogDNA-formatted lines.
   */
  static claimAll(timestamp: number): LogDNALine[] {
    const lines: LogDNALine[] = []
    for (const context of Context.contexts.values()) {
      if (!(context.unclaimed || context.isOrphaned(timestamp))) {
        continue
      }
      lines.push(context.toLogDNALine())
      context.claim(timestamp)
    }

    return lines
  }

  static async confirmAll(timestamp: number): Promise<void> {
    const toDelete: number[] = []
    for (const [ts, context] of Context.contexts) {
      if (context.batched === timestamp) {
        // set batched to a timestamp impossibly far in the future
        // so it can't become orphaned
        context.batched = Number.MAX_SAFE_INTEGER
        // prepare to delete this Context later
        toDelete.push(ts)
        // Context.contexts.delete(ts);
      }
    }
    try {
      // delay deleting contexts so that ConsoleLines can still get their
      // associated request/response rays (like log messages sent in a waitUntil
      // Promise)
      await timeout(DELETE_LOGGED_CONTEXTS_AFTER)
    }
    finally {
      // now delete those Contexts
      toDelete.forEach((ts) => {
        Context.contexts.delete(ts)
      })
    }
  }

  static getByTimestamp(timestamp: number): Context | undefined {
    return Context.contexts.get(timestamp)
  }

  static getRequestRay(timestamp: number): string | undefined {
    return Context.contexts.get(timestamp)?.requestRay
  }

  static getResponseRay(timestamp: number): string | undefined {
    return Context.contexts.get(timestamp)?.responseRay
  }

  push(): void {
    Context.contexts.set(this.timestamp, this)
  }

  toLogDNALine(): LogDNALine {
    // this line contains the request as well as the response that was sent to
    // event.respondWith
    const reqRay = this.requestRay
    const respRay = this.responseRay

    const contextLine: LogDNALine = {
      timestamp: this.timestamp,
      app: self.WORKER_NAME,
      level: "INFO",
      line: JSON.stringify({
        message: this.message,
        request: this.request,
        response: this.response,
      }),
      meta: {
        cf: this.cf,
        eventTimestamp: this.timestamp,
        "request-ray": reqRay,
        "response-ray": respRay,
        type: "fetch",
      },
    }

    return contextLine
  }


}
