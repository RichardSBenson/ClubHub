# Reports and CSV export

`/o/:slug/reports` lists what the signed-in person may see. Each report can be viewed (first 200 rows) or downloaded as CSV (UTF-8 with a byte-order mark, so Excel reads macrons; cells starting `= + - @` are prefixed with `'` so a hostile name cannot run as a formula).

| Report | Who | Dates |
|---|---|---|
| Members (contact, grade, fees standing, last trained) | owner, administrator, registrar | no |
| Fees owing (unpaid, overdue, due soon; worst first) | owner, administrator, registrar | no |
| Payments received (with receipt numbers, method, total) | owner, administrator | from/to |
| Attendance (classes per member) | + instructor | from/to |
| Grading history (grade, result, certificate, ratified) | owner, administrator, registrar | from/to |

A club sees its own people. A federation or region sees everybody in the clubs beneath it, with a Club column. Downloads are written to the audit log (`report_exported`).
