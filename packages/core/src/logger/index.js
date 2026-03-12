const _ts = () => new Date().toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

export class ConsoleLogger {
    log(...args)   { console.log(`[${_ts()}]`, ...args); }
    warn(...args)  { console.warn(`[${_ts()}]`, ...args); }
    error(...args) { console.error(`[${_ts()}]`, ...args); }
}

export const defaultLogger = new ConsoleLogger();
