# Log Scanner

- [Features](#features)
- [Input](#input)
- [Output](#output)

## Features
Log scanner helps you to find particular text in your log files. It can scan [Apify](https://apify.com/) runs, tasks or actors but also arbitrary text files. If you ever had a problem finding that one error in a thousand runs, this is a tool to use.

- Matches regular expressions on every line of the text
- Scans infinite amount of Apify runs or text file URLs
- Provides detailed report about every match
- Can scan an actor or task with a started at and finished at bounds

## Input
Check [detailed input description](https://apify.com/lukaskrivka/log-scanner/input-schema) or just try the task on Apify.

## Output
Each matched regular expression provides a detailed report

```
{
  "lineText": "2020-08-11T12:55:25.677Z   TypeError: extractors is not a function",
  "line": 4,
  "matches": [
    "Error"
  ],
  "regex": "/Error/",
  "runId": "qW3fjxtLoYbRwIt28",
  "runStartedAt": "2020-08-11T12:55:19.411Z",
  "runFinishedAt": "2020-08-11T12:55:26.662Z"
}
```
