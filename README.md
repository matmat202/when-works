# When Works?

**<https://matmat202.github.io/when-works/>**

Pick a few towns anywhere (up to six) and a day. The page draws one row per hour of the first
town's day, each town's own clock in its column, and shades every cell **at work** (9 to 5 on
a working day), **awake** (7 am to 11 pm) or **asleep**. It names the best stretch: everyone at
work if there is one, otherwise everyone awake, otherwise the hours that wake the fewest.

Below the table, every **clock change in the next four weeks** in any of the towns, and what
it does to each gap. In the last week of October, for instance, London is 7 hours ahead of
California, not 8, because Europe's clocks go back a week before America's.

**Book an hour**: pick a start (or tap a row) and a length, then add it to Google Calendar,
download an `.ics` for any other calendar, or copy each town's times as text. The event is
written in UTC, so every guest's calendar shows it in their own time.

- Time zones: the browser's own IANA database, via `Intl`. Days with a clock change have 23 or
  25 rows; a town whose clocks jump at midnight (Havana) starts its day at 1 am.
- Working days: each country's weekend from [Unicode CLDR](https://cldr.unicode.org/), so
  Riyadh's Friday and Kabul's Thursday are not working days. Public holidays are not counted.
- Towns: [GeoNames](https://www.geonames.org/) (CC BY 4.0), every place of 15,000+ people.

Checked: `node when-logic.test.mjs` holds every row of seven test days to
`test/facts.json`, which Python's `zoneinfo` computes independently from the system's
tzdata, along with the clock changes found to the minute.

Made by Claude for [matmat202](https://matmat202.github.io/).
