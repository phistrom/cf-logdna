import { ErrorObject, LogDNALine, Severity } from "./types"
import { Loggable } from "./loggable"
import { Context } from "./context"
import { convertErrorToObject } from "./utils"


export class ConsoleLine extends Loggable {
  /**
   * Value of event.timeStamp. If console.log was called directly, this will
   * be undefined.
   */
  public readonly eventTimestamp?: number

  /**
   * Equal to Date.now() when this ConsoleLine was created. Cloudflare Workers
   * does not advance the clock in between calls to fetch() to prevent timing
   * attacks so this timestamp will not be 100% accurate.
   */
  public readonly timestamp: number

  /**
   * The severity of the log message
   */
  public readonly level: Severity

  /**
   * The content of the log message
   */
  public readonly line: string

  /**
   * All ConsoleLine objects waiting to be pushed to LogDNA.
   * @private
   */
  private static consoleLines: ConsoleLine[] = []

  constructor(eventTimestamp: number | undefined, severity: Severity, data: any[]) {
    super()
    this.eventTimestamp = eventTimestamp
    this.timestamp = Date.now()
    this.level = severity
    this.line = ConsoleLine.stringifyArgs(data)
  }

  /**
   * Get all unclaimed/orphaned ConsoleLines, claim them, and return their
   * LogDNA-formatted lines.
   */
  static claimAll(timestamp: number): LogDNALine[] {
    const lines: LogDNALine[] = []
    for (const consoleLine of ConsoleLine.consoleLines) {
      if (!(consoleLine.unclaimed || consoleLine.isOrphaned(timestamp))) {
        continue
      }
      lines.push(consoleLine.toLogDNALine())
      consoleLine.claim(timestamp)
    }
    return lines
  }

  static confirmAll(timestamp: number): void {
    // filter out all Contexts that were claimed by the given timestamp
    ConsoleLine.consoleLines = ConsoleLine.consoleLines.filter((consoleLine) => {
      return consoleLine.batched !== timestamp
    })
  }

  push(): void {
    ConsoleLine.consoleLines.push(this)
  }

  private static stringifyArgs(args: any[]): string {
    const stringified: any[] = args.map(ConsoleLine.toJsonFriendlyObject)
    let line: any
    let message: string | undefined = undefined

    if (stringified.length === 1) {
      // array only has one element so let's unpack it
      line = stringified[0]
      if (typeof line === "string") {
        return line  // it's already a string
      }
      else if (line.unhandledException) {
        message = `Unhandled Exception: '${line.unhandledException.message}'`
      }
    }
    else {
      line = stringified
      // if only
      const allPrintables = args.reduce((acc: boolean, cur: any) => acc && !["object", "function"].includes(cur))
      if (allPrintables) {
        message = line.join(" ")
      }
    }

    const lineJson: any = {
      console: line,
      message: message,
    }

    return JSON.stringify(lineJson)
  }

  private static toJsonFriendlyObject(arg: any): any {
    let retVal: string | { headers: { [p: string]: string } } | { error: ErrorObject }

    // if(Array.isArray(arg)) {
    // // TODO We should not be recursive here until we can handle circular references
    //   return arg.map(ConsoleLine.toJsonFriendlyObject)
    // }

    const type = typeof arg

    if (type === "function") {
      // semicolon appended to avoid LogDNA trying to parse it as JSON
      retVal = `ƒ ${arg};`
    }
    else if (["boolean", "number", "bigint", "symbol"].includes(type)) {
      // Return something like Boolean(true) or Number(42).
      // That way we know the original type before it was cast to a string.
      // arg.toString() is required when arg is a Symbol.
      const titleCaseType = type[0].toUpperCase() + type.slice(1)
      retVal = `${titleCaseType}(${arg.toString()})`
    }
    else if (type === "string") {
      retVal = arg
    }
    else if (type === "undefined") {
      retVal = "undefined"
    }
    else { // object, presumably
      if (arg instanceof Error) {
        // special handling for error objects
        retVal = {
          error: convertErrorToObject(arg),
        }
      }
      else if (arg instanceof Headers) {
        // special handling of Headers object so it works with JSON.stringify
        retVal = {
          headers: Object.fromEntries(arg),
        }
      }
      else {
        // @ts-ignore
        retVal = arg  // this could be any
      }
    }

    return retVal
  }

  toLogDNALine(): LogDNALine {
    // Using console.log directly means the eventTimestamp will be unavailable
    // The only way this.timestamp will obtain a response/request ray is if
    // no I/O had occurred yet when the console.log was called and therefore
    // event.timeStamp will match Date.now()
    const ts = this.eventTimestamp || this.timestamp

    // attempt to associate this log line with a request/response context
    const reqRay = Context.getRequestRay(ts)
    const respRay = Context.getResponseRay(ts)

    // If reqRay or respRay are defined, that means the log timestamp is the
    // same as the event timestamp. Therefore we can set eventTimestamp to
    // timestamp.
    // Obviously if `this.eventTimestamp` is defined, we can set the eventTimestamp
    const ets = reqRay || respRay || this.eventTimestamp ? ts : undefined

    const line: LogDNALine = {
      timestamp: this.timestamp,
      app: self.WORKER_NAME,
      level: this.level,
      line: this.line,
      meta: {
        timestamp: this.timestamp,
        eventTimestamp: ets,
        "request-ray": reqRay,
        "response-ray": respRay,
        type: "console",
      },
    }

    return line
  }
}
