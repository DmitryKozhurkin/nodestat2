# nodestat2
![график nodestat](http://i.imgur.com/SdRfXJH.png)

```

nodestat.init({
  app,            // express приложение (добавит в приложение страницу /nodestat с графиками)
  mongoClient,    // коннект к Mongo
  domain,         // домен
  pool,           // список доменов
  period,         // срок хранения метрик в Mongo
  interval        // интервал записи метрик в Mongo
})

nodestat.inc(metricName[, value]);
nodestat.avg(metricName, value);
nodestat.max(metricName, value);
nodestat.per(metricName, totalValue[, scoredValue]);

```
