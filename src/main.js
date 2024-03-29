const Apify = require('apify');

const { utils: { log } } = Apify;

Apify.main(async () => {
    const input = await Apify.getInput();

    const {

        runIdsOrUrls = [],
        regexes = [],
        actorOrTaskId,
        dateFrom,
        dateTo,
        // maxRuns = 999999,
        token,
    } = input;

    const client = Apify.newClient({ token });

    const parsedRegexes = regexes.map((str) => {
        // str can be plain string or wrapped in /str/g or similar
        const regexFormatMatch = str.match(/\/(.+)\/([a-z]+)/);
        if (!regexFormatMatch) {
            return new RegExp(str);
        }
        const [, regexBody, flags] = regexFormatMatch;
        return new RegExp(regexBody, flags);
    });

    // Runs to scan
    const sources = [];

    if (actorOrTaskId) {
        // Test if the provided ID is actor or task or crash
        let clientConfig;
        
        const actor = await client.actor(actorOrTaskId).get();
        if (actor) {
            log.info(`Provided actorOrTaskId is an actor, will scan it's runs`);
            clientConfig = {
                namespace: 'actor',
                id: actorOrTaskId,
            };
        } else {
            // actor not found, it is a task
            isActor = false;
            const task = await client.task(actorOrTaskId).get();
            if (!task) {
                throw `Cannot load actor or task with the specified ID ${actorOrTaskId}, is this ID correct?`;
            }
            log.info(`Provided actorOrTaskId is a task, will scan it's runs`);
            clientConfig = {
                namespace: 'task',
                id: actorOrTaskId,
            };
        }
        
        let allRuns = [];

        // TODO: Only load runs necessary for the time range
        let offset = 0;
        const limit = 1000;
        for (;;) {
            const { items } = await client[clientConfig.namespace](clientConfig.id)
                .runs().list({ offset, limit });
            allRuns = allRuns.concat(items);
            const doStop = items.length < 1000;
            log.info(`Loaded ${items.length} runs with offset ${offset}, ${doStop ? 'Loading finished' : 'Loading next batch'}`);
            if (doStop) {
                break;
            }

            offset += limit;
        }
        log.info(`Total loaded runs: ${allRuns.length}`);

        const dateFromAsDate = dateFrom ? new Date(dateFrom) : null;
        const dateToAsDate = dateTo ? new Date(dateTo) : null;
        log.info(`From date: ${dateFromAsDate}, to date: ${dateToAsDate}`);

        const filteredRuns = allRuns.filter((run) => {
            const { startedAt } = run;
            const fitsDateFrom = dateFrom ? startedAt >= dateFromAsDate : true;
            const fitsDateTo = dateTo ? startedAt <= dateToAsDate : true;
            if (fitsDateFrom && fitsDateTo) {
                log.info(`Run startedAt ${startedAt} fits into the chosen date and will be scanned`);
                return true;
            } else {
                log.info(`Run startedAt ${startedAt} doesn't fit into the chosen date and will not be scanned`);
            }
        });

        log.info(`Runs that fit into dates: ${filteredRuns.length}`);
        for (const run of filteredRuns) {
            sources.push({
                url: 'http://example.com',
                uniqueKey: run.id,
                userData: {
                    idOrUlr: run.id,
                    startedAt: run.startedAt,
                    finishedAt: run.finishedAt,
                },
            });
        }
    }

    for (const runIdOrUrl of runIdsOrUrls) {
        sources.push({
            url: 'http://example.com',
            uniqueKey: runIdOrUrl,
            userData: {
                idOrUlr: runIdOrUrl,
            },
        });
    }

    const requestList = await Apify.openRequestList('start-urls', sources);

    const crawler = new Apify.BasicCrawler({
        requestList,
        maxRequestRetries: 0,
        maxConcurrency: 5,
        handleRequestFunction: async (context) => {
            const { userData: { idOrUlr, startedAt, finishedAt } } = context.request;

            const isUrl = idOrUlr.match(/https?:\/\//);
            let logText;
            if (isUrl) {
                const { body } = await Apify.utils.requestAsBrowser({ url: idOrUlr });
                logText = body.toString();
            } else {
                logText = await client.log(idOrUlr).get();
            }

            if (typeof logText !== 'string') {
                throw new Error(`Log returned for ${idOrUlr} is not a string`);
            }

            const lines = logText.split('\n');

            let lineIndex = 0;
            let matchedRegexes = 0;
            let matchedLines = 0;
            try {
                for (const line of lines) {
                    let wasLineMatched = false;
                    for (const regex of parsedRegexes) {
                        const match = line.match(regex);
                        if (match) {
                            await Apify.pushData({
                                lineText: line,
                                line: lineIndex,
                                matches: match,
                                regex: regex.toString(),
                                runId: idOrUlr,
                                runStartedAt: startedAt,
                                runFinishedAt: finishedAt,
                            });
                            matchedRegexes++;
                            wasLineMatched = true;
                        }
                    }
                    if (wasLineMatched) {
                        matchedLines++;
                    }
                    lineIndex++;
                }
            } catch (e) {
                log.error(`log ${idOrUlr} matching failed with error`, e);
                console.dir(e);
            } finally {
                const dateInfo = startedAt ? ` (${startedAt} - ${finishedAt || ''})` : '';
                log.info(`Log ${idOrUlr} - matches: ${matchedRegexes}, matched lines/total: ${matchedLines}/${lines.length} ${dateInfo}`);
            }
        },
    });

    log.info('Starting the crawl.');
    await crawler.run();
    log.info('Crawl finished.');
});
