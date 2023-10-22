import { onFCP, onLCP, Metric } from 'web-vitals';

const LONG_TASK = 'longtask';
const FPS = 'fps';
const PAGE_BUSY = 'pageBusy';
const NAVIGATION = 'navigation';
const LARGEST_CONTENTFUL_PAINT = 'largest-contentful-paint';
const FCP = 'FCP';
const LCP = 'LCP';
const PAINT = 'paint';

/*

*/

export class TTIBoomerang2 {
    private fcpTime: number | null = null;
    private lcpTime: number | null = null;
    private domContentLoadedEventEnd: number | null = null;
    private visuallyReadyTimestamp: number | null = null;
    private ttiTracker: any = {};
    private ttiResolved = false;

    private fcpSupported = false;
    private lcpSupported = false;

    private COLLECTION_PERIOD = 100;
    private REQUIRED_OK_INTERVALS = 5;
    private CHECK_PERIOD = 1000; // Perform another check for TTI/Visually ready
    private VISUALLY_READY_RESOLVE_TIMEOUT = 10000;
    private TTI_RESOLVE_TIMEOUT = 10000;

    // Needs to return a Promise
    public computeTimeToInteractive() {
        this.initListeners();
        return new Promise<number>((resolve, reject) => {
            this.checkForVisualReady().then((result) => {
                this.computeTTI(result).then((result) => {
                    resolve(result);
                });
            });
        });
    }

    private checkForVisualReady(): Promise<number> {
        // Check if visually ready
        return new Promise<number>((resolve, reject) => {
            let timeIntervals = 0;
            const visuallyReadyInterval: any = setInterval(() => {
                // Check if all Visually ready timestamps are available
                let visuallyReady = true;
                console.log(
                    this.lcpTime,
                    this.fcpTime,
                    this.domContentLoadedEventEnd
                );

                if (this.fcpSupported) {
                    if (!this.fcpTime) {
                        visuallyReady = false;
                    }
                }
                if (this.lcpSupported) {
                    if (!this.lcpTime) {
                        visuallyReady = false;
                    }
                }

                if (!this.domContentLoadedEventEnd) {
                    visuallyReady = false;
                }

                if (
                    visuallyReady ||
                    timeIntervals * this.CHECK_PERIOD >
                        this.VISUALLY_READY_RESOLVE_TIMEOUT
                ) {
                    // If timed out, check if any VR signals are present, else can't find tti
                    if (
                        timeIntervals * this.CHECK_PERIOD >
                        this.VISUALLY_READY_RESOLVE_TIMEOUT
                    ) {
                        if (
                            !this.fcpTime &&
                            !this.lcpTime &&
                            !this.domContentLoadedEventEnd
                        ) {
                            // No visually ready timestamps so can't compute tti
                            reject();
                        }
                    }
                    // Visually ready so start checking for TTI
                    clearInterval(visuallyReadyInterval);

                    this.visuallyReadyTimestamp = Math.max(
                        this.fcpTime ? this.fcpTime : 0,
                        this.lcpTime ? this.lcpTime : 0,
                        this.domContentLoadedEventEnd
                            ? this.domContentLoadedEventEnd
                            : 0
                    );

                    resolve(this.visuallyReadyTimestamp);
                }
                timeIntervals += 1;
            }, this.CHECK_PERIOD);
        });
    }

    private handleWebVitals(metric: Metric) {
        console.log(metric);

        if (metric.name === FCP) {
            metric.entries.forEach(
                (entry) => (this.fcpTime = entry.startTime + entry.duration)
            );
        }
        if (metric.name === LCP) {
            metric.entries.forEach(
                (entry) => (this.lcpTime = entry.startTime + entry.duration)
            );
        }
    }

    private computeTTI(visuallyReadyTimestamp: number): Promise<number> {
        return new Promise<number>((resolve, reject) => {
            const startBucket = Math.max(
                this.computeTimeWindow(visuallyReadyTimestamp),
                0
            );
            let currBucket = startBucket;
            let okIntervals = 0;
            let totalIntervals = 0;

            const tti: any = setInterval(() => {
                if (
                    totalIntervals * this.CHECK_PERIOD >
                    this.TTI_RESOLVE_TIMEOUT
                ) {
                    // TTI did not resolve in timeout period, so TTI can't be computed
                    reject();
                }

                const endBucket = this.computeTimeWindow();
                for (let bucket = currBucket; bucket <= endBucket; bucket++) {
                    currBucket = bucket;
                    let allOk = true;

                    if (
                        !this.ttiTracker[LONG_TASK] &&
                        !this.ttiTracker[FPS] &&
                        !this.ttiTracker[PAGE_BUSY]
                    ) {
                        // can't resolve tti so wait and try again

                        break;
                    }

                    // Check long task
                    if (
                        this.ttiTracker[LONG_TASK] &&
                        this.ttiTracker[LONG_TASK][bucket] &&
                        this.ttiTracker[LONG_TASK][bucket] > 0
                    ) {
                        allOk = false;
                    }

                    // Check FPS
                    if (
                        this.ttiTracker[FPS] &&
                        this.ttiTracker[FPS][bucket] &&
                        this.ttiTracker[FPS][bucket] < 2
                    ) {
                        allOk = false;
                    }

                    // Check page busy only if long task not supported
                    if (
                        !this.ttiTracker[LONG_TASK] &&
                        this.ttiTracker[PAGE_BUSY] &&
                        this.ttiTracker[PAGE_BUSY][bucket] &&
                        this.ttiTracker[PAGE_BUSY][bucket] > 10
                    ) {
                        allOk = false;
                    }

                    // if all ok, increment ok interval by 1 and then check if 5 are done. if yes, resolve, else continue
                    if (allOk) {
                        okIntervals += 1;
                        if (okIntervals >= this.REQUIRED_OK_INTERVALS) {
                            this.ttiResolved = true;
                            clearInterval(tti);

                            resolve(
                                visuallyReadyTimestamp +
                                    (currBucket - startBucket) *
                                        this.COLLECTION_PERIOD
                            );
                            break;
                        } else {
                            continue;
                        }
                    } else {
                        okIntervals = 0;
                    }

                    currBucket = endBucket;
                }
                totalIntervals += 1;
            }, this.CHECK_PERIOD);
        });
    }

    private initListeners() {
        // Use perf observer to record long tasks and domcontentloaded
        this.eventListener();

        // Record support for FCP and LCP and init listeners
        this.lcpSupported =
            window.PerformanceObserver.supportedEntryTypes.includes(
                LARGEST_CONTENTFUL_PAINT
            );
        this.fcpSupported =
            window.PerformanceObserver.supportedEntryTypes.includes(PAINT);

        // Use libraries instead of directly looking at the entries as it has better suppport
        if (this.fcpSupported) {
            onFCP((metric) => this.handleWebVitals(metric));
        }
        if (this.lcpSupported) {
            onLCP((metric) => this.handleWebVitals(metric));
        }

        // Init FPS listener
        this.framesPerSecondListener();
    }

    private computeTimeWindow(currTime?: number) {
        if (typeof currTime === 'undefined') {
            return Math.floor(performance.now() / this.COLLECTION_PERIOD);
        } else {
            return Math.floor(currTime / this.COLLECTION_PERIOD);
        }
    }

    private addToTracker(type: string, bucket: number, value: any) {
        if (!this.ttiTracker[type]) {
            this.ttiTracker[type] = [];
        }

        if (!this.ttiTracker[type][bucket]) {
            this.ttiTracker[type][bucket] = 0;
        }

        this.ttiTracker[type][bucket] += value;
    }

    eventListener = () => {
        const eventObserver = new window.PerformanceObserver((list) => {
            console.log(list.getEntries());
            list.getEntries()
                .filter(
                    (e) =>
                        e.entryType === LONG_TASK || e.entryType === NAVIGATION
                )
                .forEach((event) => {
                    if (event.entryType === LONG_TASK) {
                        // Add to the time buckets where the long task spreads over
                        if (event.startTime && event.duration) {
                            const endTime = event.startTime + event.duration;
                            this.addToTracker(
                                LONG_TASK,
                                this.computeTimeWindow(event.startTime),
                                1
                            );
                            this.addToTracker(
                                LONG_TASK,
                                this.computeTimeWindow(endTime),
                                1
                            );
                        }
                    }
                    if (event.entryType === NAVIGATION) {
                        if (event.toJSON().domContentLoadedEventEnd) {
                            this.domContentLoadedEventEnd =
                                event.toJSON().domContentLoadedEventEnd;
                        }
                    }
                });
        });
        eventObserver.observe({
            entryTypes: [LONG_TASK, NAVIGATION]
        });
    };

    /*
    Track frames per second 
    */
    framesPerSecondListener = () => {
        const trackFrames = () => {
            // increment FPS by 1 in tracker for time window
            this.addToTracker(FPS, this.computeTimeWindow(), 1);

            window.requestAnimationFrame(trackFrames);
        };

        if (!this.ttiResolved) {
            window.requestAnimationFrame(trackFrames);
        }
    };
    /*
    Track page busy 
    */

    // pageBusyListener = () => {};
}
