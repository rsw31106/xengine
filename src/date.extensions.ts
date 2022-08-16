import { XUtil } from "./xUtil";
export {};

declare global {
  interface Date {
    toMysqlFormat(): string;
    toMysqlDateFormat(): string;    
    getUnixTimeInSec(): number;
    getUnixTimeInMS(): number;

    clone(): Date;

    addDays(n: number): Date;
    addSeconds(n: number): Date;

    isSameDate(date: Date): boolean;
    isToday(now?: Date): boolean;
    isWeekend(): boolean;
  }
  interface DateConstructor {
    fromMysqlFormat(s: string): Date;
    getUnixTimeInSec(): number;
    getUnixTimeInMS() : number;
  }
}

// Add Function in Date type
Date.prototype.toMysqlFormat = function () {
  return (
    this.getFullYear() +
    "-" +
    XUtil.TwoDigits(1 + this.getMonth()) +
    "-" +
    XUtil.TwoDigits(this.getDate()) +
    " " +
    XUtil.TwoDigits(this.getHours()) +
    ":" +
    XUtil.TwoDigits(this.getMinutes()) +
    ":" +
    XUtil.TwoDigits(this.getSeconds())
  );
};

Date.prototype.toMysqlDateFormat = function () {
  return (
    this.getFullYear() +
    "-" +
    XUtil.TwoDigits(1 + this.getMonth()) +
    "-" +
    XUtil.TwoDigits(this.getDate())
  );
};
Date.fromMysqlFormat = function (mysql_string: string): Date {
  let t: string[],
    result = null;
  t = mysql_string.split(/[- :]/);
  //when t[3], t[4] and t[5] are missing they defaults to zero
  result = new Date(
    Number(t[0]),
    Number(t[1]) - 1,
    Number(t[2]),
    t[3] ? Number(t[3]) : 0,
    t[4] ? Number(t[4]) : 0,
    t[5] ? Number(t[5]) : 0
  );
  return result;
};
Date.prototype.clone = function (): Date {
  return new Date(+this);
};
Date.prototype.addDays = function (days: number): Date {
  if (!days) {
    return new Date(this.valueOf());
  }
  let date = new Date(this.valueOf());
  date.setDate(date.getDate() + days);
  return date;
};
Date.prototype.addSeconds = function (seconds: number): Date {
  if (!seconds) {
    return new Date(this.valueOf());
  }
  let date = new Date(this.valueOf());
  date.setSeconds(date.getSeconds() + seconds);
  return date;
};
Date.prototype.getUnixTimeInSec = function () {
    return Math.floor(this.getTime() / 1000);
  };
Date.prototype.getUnixTimeInMS = function () {
    return this.getTime();
  };

Date.getUnixTimeInSec = function () {
  return Math.floor(Date.now() / 1000);
};
Date.getUnixTimeInMS = function () {
  return Date.now();
};
Date.prototype.isSameDate = function (date: Date): boolean {
  return (
    date &&
    this.getFullYear() === date.getFullYear() &&
    this.getMonth() === date.getMonth() &&
    this.getDate() === date.getDate()
  );
};
Date.prototype.isWeekend = function (): boolean {
  return this.getDay() === 0 || this.getDay() === 6;
};
Date.prototype.isToday = function (now?: Date): boolean {
  const today = now ? now : new Date();
  return this.isSameDate(today);
};
