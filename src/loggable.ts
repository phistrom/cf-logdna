import { LogDNALine } from "./types"
import { ORPHANED_TIME } from "./constants"

export abstract class Loggable {
  protected batched?: number

  protected constructor() {
    this.batched = undefined
  }

  /**
   * No Worker has claimed responsible for sending this Context to
   * LogDNA.
   */
  get unclaimed(): boolean {
    return this.batched === undefined
  }

  /**
   * The Worker context that calls this will claim to be responsible for
   * sending this Context to LogDNA. This is done to prevent other Worker
   * contexts from claiming this Context and sending the same one multiple
   * times to LogDNA.
   */
  claim(timestamp: number) {
    this.batched = timestamp
  }

  // this should be abstract static, but TypeScript doesn't allow that yet
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  static claimAll(timestamp: number): LogDNALine[] {
    throw new Error("claimAll is not implemented.")
  }

  // this should be abstract static, but TypeScript doesn't allow that yet
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  static confirmAll(timestamp: number): void {
    // abstract
    throw new Error("confirmAll is not implemented.")
  }

  /**
   * An orphaned context is one that was claimed by a batch operation, but
   * never got sent. This is false when `batched` is undefined (this Context
   * has never been claimed by a Worker for sending to LogDNA) or if the
   * `batched` timestamp is less than `ORPHANED_TIME` milliseconds old.
   */
  isOrphaned(timestamp: number): boolean {
    if (this.batched === undefined) {
      return false
    }

    return (this.batched + ORPHANED_TIME) < timestamp
  }

  /**
   * Returns true if the calling Worker context's timestamp matches the
   * value of this.batched (set by calling `claim()`)
   */
  isOwned(timestamp: number): boolean {
    return this.batched === timestamp
  }

  abstract toLogDNALine(): LogDNALine
}
