const DEFAULT_RECHECK_INTERVAL = 200;
const PLUGIN_NAME = "WatchConditionalAggregatePlugin";
const FALSE_CONDITION_PRINT_INTERVAL = 10000;

/**
 * Plugin configuration options.
 */
export interface Options {
  /**
   * Should return true if the webpack build is OK to be started, and a debug
   * message (as an array of strings) otherwise. The debug message will be
   * printed to console time to time; if you don't want this, just return an
   * empty array.
   */
  condition: (changes: Set<string>, removals: Set<string>) => true | string[];

  /**
   * The condition function will be called not more often than this number of
   * milliseconds.
   */
  recheckInterval?: number;
}

/**
 * Prints a debug message on false condition once every
 * FALSE_CONDITION_PRINT_INTERVAL ms.
 */
class FalseConditionPrinter {
  private printedAt?: number;

  constructor(private logger: any) {}

  onFalse(why: string[]) {
    if (!this.printedAt) {
      this.printedAt = Date.now();
    }

    if (Date.now() - this.printedAt > FALSE_CONDITION_PRINT_INTERVAL) {
      this.printedAt = Date.now();
      if (why.length > 0) {
        this.logger.info(why.join(" "));
      }
    }
  }

  reset() {
    this.printedAt = undefined;
  }
}

/**
 * A wrapped for webpack watcher handler.
 */
class ConditionalAggregateFileSystem {
  constructor(
    private logger: any,
    private wfs: any,
    private condition: Options["condition"],
    private recheckInterval: number
  ) {}

  watch(
    files: any,
    dirs: any,
    missing: any,
    startTime: any,
    options: any,
    callback: any,
    callbackInstant: any
  ) {
    let changes = new Set<string>();
    let removals = new Set<string>();
    let timeout: any = undefined;
    const printer = new FalseConditionPrinter(this.logger);

    return this.wfs.watch(
      files,
      dirs,
      missing,
      startTime,
      options,
      (
        err: any,
        fileTimestamps: any,
        dirTimestamps: any,
        changedFiles: Set<string>,
        removedFiles: Set<string>
      ) => {
        const runCallback = () => {
          if (timeout) {
            clearTimeout(timeout);
            timeout = undefined;
          }

          if (err) {
            printer.reset();
            callback(err);
            return;
          }

          const res = this.condition(changes, removals);
          if (res === true) {
            const copyChanges = changes;
            const copyRemovals = removals;
            changes = new Set();
            removals = new Set();
            printer.reset();
            callback(
              err,
              fileTimestamps,
              dirTimestamps,
              copyChanges,
              copyRemovals
            );
          } else {
            printer.onFalse(res);
            timeout = setTimeout(runCallback, this.recheckInterval);
          }
        };

        if (!err) {
          changedFiles.forEach((file) => changes.add(file));
          removedFiles.forEach((file) => removals.add(file));
        }

        runCallback();
      },
      callbackInstant
    );
  }
}

export default class ConditionalAggregateWebpackPlugin {
  constructor(private options: Options) {}

  apply(compiler: any) {
    const logger = compiler.getInfrastructureLogger(PLUGIN_NAME);
    const printer = new FalseConditionPrinter(logger);
    const recheckInterval =
      this.options.recheckInterval || DEFAULT_RECHECK_INTERVAL;
    let firstRun = true;

    compiler.hooks.watchRun.tapPromise(PLUGIN_NAME, async () => {
      if (firstRun) {
        firstRun = false;
        while (true) {
          const res = this.options.condition(new Set(), new Set());
          if (res === true) {
            printer.reset();
            break;
          } else {
            printer.onFalse(res);
            await new Promise((resolve) =>
              setTimeout(resolve, recheckInterval)
            );
          }
        }
      }
    });

    compiler.hooks.afterEnvironment.tap(PLUGIN_NAME, () => {
      compiler.watchFileSystem = new ConditionalAggregateFileSystem(
        logger,
        compiler.watchFileSystem,
        this.options.condition,
        recheckInterval
      );
    });
  }
}
