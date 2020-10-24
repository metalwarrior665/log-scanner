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

    if (token) {
        Apify.client.setOptions({ token });
    }

    const parsedRegexes = regexes.map((str) => {
        // str can be plain string or wrapped in /str/g or similar
        const regexFormatMatch = str.match(/\/(.+)\/([a-z]+)/);
        if (!regexFormatMatch) {
            return new RegExp(str);
        }
        const [, regexBody, flags] = regexFormatMatch;
        return new RegExp(regexBody, flags);
    });

    // Test if the provided ID is actor or task or crash
    let isActor = true;
    try {
        await Apify.client.acts.getAct({ actId: actorOrTaskId, userId: 'xgD4TryiQ6GgcfkNo' });
    } catch (e) {
        // actor not found, it is a task
        isActor = false;
        try {
            await Apify.client.tasks.getTask({ taskId: actorOrTaskId, userId: 'xgD4TryiQ6GgcfkNo' });
        } catch (e) {
            throw 'Cannot load actor or task with the specified ID, is your ID correct?';
        }
    }

    let listRunsOptions;
    if (isActor) {
        listRunsOptions = {
            namespace: 'acts',
            callOptions: { actId: actorOrTaskId },
        };
    } else {
        listRunsOptions = {
            namespace: 'tasks',
            callOptions: { taskId: actorOrTaskId },
        };
    }

    const sources = [];

    if (listRunsOptions) {
        let allRuns = [];

        // TODO: Only load runs necessary for the time range
        let offset = 0;
        const limit = 1000;
        while (true) {
            const { items } = await Apify.client[listRunsOptions.namespace]
                .listRuns({ ...listRunsOptions.callOptions, offset, limit });
            allRuns = allRuns.concat(items);
            const doStop = items.length < 1000;
            log.info(`Loaded ${items.length} runs with offset ${offset}, ${doStop ? 'Loading finished' : 'Loading next batch'}`);
            if (doStop) {
                break;
            }

            offset += limit;
        }
        log.info(`Total loaded runs: ${allRuns.length}`);

        const filteredRuns = allRuns.filter((run) => {
            const { startedAt } = run;
            const fitsDateFrom = dateFrom ? new Date(startedAt) >= new Date(dateFrom) : true;
            const fitsDateTo = dateTo ? new Date(startedAt) <= new Date(dateTo) : true;
            if (fitsDateFrom && fitsDateTo) {
                return true;
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
                logText = await Apify.client.logs.getLog({ logId: idOrUlr });
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
