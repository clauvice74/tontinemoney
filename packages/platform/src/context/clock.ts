/** Horloge injectable : permet aux tests de voyager dans le temps (expirations, échéances). */
export abstract class Clock {
  abstract now(): Date;
  today(): string {
    return this.now().toISOString().slice(0, 10);
  }
}

export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}

export class FixedClock extends Clock {
  private current: Date;
  constructor(initial: Date | string = new Date()) {
    super();
    this.current = new Date(initial);
  }
  now(): Date {
    return new Date(this.current.getTime());
  }
  set(date: Date | string): void {
    this.current = new Date(date);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
  advanceDays(days: number): void {
    this.advance(days * 86_400_000);
  }
}
