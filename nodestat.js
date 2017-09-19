/**
 * Модуль для сбора статистики ноды
 */

'use strict';

const _      = require('lodash');
const moment = require('moment');

class Nodestat {

	constructor () {
		this.domain     = null;
		this.collection = null;
		this.metrics    = {}; // контейнер для значений статистики текущего временного интервала
		this.handlers   = {}; // контейнер для обработчиков событий
	}

	init (options) {

		let {app, mongoClient, domain, pool, period, interval} = options;

		this.domain = domain;
		this.collection = mongoClient.collection('nodestat2');


		if (app) {
			require('./controller')(options);
		}

		Promise.all([
			this.collection.ensureIndex({domain: 1, minute: 1}, {unique: true, background: true}),
			this.collection.ensureIndex({domain: 1, updated: 1}, {background: true}),
			this.collection.ensureIndex({minute: 1}, {background: true, expireAfterSeconds: period}),
			this.collection.ensureIndex({domain: 1}, {background: true}),
			this.collection.ensureIndex({updated: 1}, {background: true})
		]).then(res => {
			this.start(interval);
		});
	}

	emit (event, ...args) {
		let handlers = this.handlers[event];

		if (! handlers) {
			return;
		}

		for (let handler of handlers) {
			handler.apply(null, args);
		}
	}

	on (event, handler) {
		if (typeof handler !== 'function') {
			return;
		}
		this.handlers[event] = this.handlers[event] || [];
		this.handlers[event].push(handler);
	}

	start (interval) {
		setInterval(() => {
			let timestamp = Date.now();
			this.emit('beforeSave', timestamp);
			this.save(timestamp);
		}, interval * 1000);
	}

	// инкрементирует значение метрики
	inc (key, value) {
		this.metrics.inc       = this.metrics.inc || {};
		this.metrics.inc[key]  = this.metrics.inc[key] || 0;
		this.metrics.inc[key] += value === undefined ? 1 : value;
	}

	// вычисление среднего значения
	avg (key, value) {
		this.metrics.avg            = this.metrics.avg || {};
		this.metrics.avg[key]       = this.metrics.avg[key] || {sum: 0, count: 0};
		this.metrics.avg[key].sum   += value;
		this.metrics.avg[key].count += 1;
	}

	// вычисление процента
	per (key, account, total) {
		this.metrics.per      = this.metrics.per || {};
		this.metrics.per[key] = this.metrics.per[key] || {account: 0, total: 0};
		this.metrics.per[key].total += total || 0;
		this.metrics.per[key].account += account || 0;
	}

	// вычисление наибольшего значения
	max (key, value) {
		this.metrics.max      = this.metrics.max || {};
		this.metrics.max[key] = this.metrics.max[key] || 0;

		if (value > this.metrics.max[key]) {
			this.metrics.max[key] = value;
		}
	}

	// обнуляет значения текущей статистики
	clear () {
		for (let i in this.metrics) {
			delete this.metrics[i];
		}
	}

	// запись метрик в базу
	save (timestamp, callback) {
		let setOnInsert = {
			created : new Date
		};

		let currentDate = {
			updated : true
		};

		let incData = {};

		let maxData = {};

		_.each(this.metrics, (map, type) => {
			_.each(map, (value, key) => {
				key = this.encodeDots(key);

				switch (type) {
					case 'inc' :
						incData[`metrics.inc.${key}`] = value;
						break;
					case 'avg' :
						incData[`metrics.avg.${key}.sum`]   = value.sum;
						incData[`metrics.avg.${key}.count`] = value.count;
						break;
					case 'per' :
						incData[`metrics.per.${key}.account`] = value.account;
						incData[`metrics.per.${key}.total`]   = value.total;
						break;
					case 'max' :
						maxData[`metrics.max.${key}`] = value;
						break;
				}
			});
		});

		let upsertData = {
			$setOnInsert : setOnInsert,
			$currentDate : currentDate
		};

		if (_.size(incData)) {
			upsertData.$inc = incData;
		}

		if (_.size(maxData)) {
			upsertData.$max = maxData;
		}

		// console.log(upsertData);

		let where = {
			domain : this.domain,
			minute : moment(timestamp).startOf('minute').toDate()
		};

		this.collection.update(where, upsertData, {upsert: true}, function() {
			// console.log(arguments);
		});

		this.clear();
	}

	encodeDots (key) {
		return key.split('.').join('\uff0e');
	}

	decodeDots (key) {
		return key.split('\uff0e').join('.');
	}

	getHistory (domain, since, groupBy, pick, metric, callback) {
		let where = {
			updated : {
				$gt: since
			}
		};

		if (domain) {
			where.domain = domain;
		}

		// console.log('Nodestat Get', domain, since, groupBy, pick);

		let field = 'metrics';

		if (pick) {
			field += `.${pick}`;
		}

		if (metric) {
			field += `.${metric}`;
		}

		let project = {
			_id     : 0,
			minute  : 1,
			updated : 1,
			[field] : 1
		};

		this.collection
		.find(where, project)
		.sort({minute: 1})
		.toArray((err, result) => {
			if (err) {
				return callback(err);
			}

			result = _.chain(result)
			.groupBy(row => moment(row.minute).startOf(groupBy).valueOf())
			.map((group, groupKey) => {
				let res       = {};
				res[groupBy]  = new Date(+groupKey);
				res.timestamp = +groupKey;
				res.updated   = 0;
				res.metrics   = {};

				// схлопываем сгруппированный массив
				_.each(group, row => {
					// вычисляем максимальную дату апдейта
					res.updated = Math.max(res.updated, row.updated);
					_.each(row.metrics, (data, type) => {
						res.metrics[type] = res.metrics[type] || {};
						_.each(data, (value, name) => {
							name = this.decodeDots(name);

							switch (type) {
								case 'inc':
									res.metrics[type][name] = (res.metrics[type][name] || 0) + value;
									break;
								case 'max':
									res.metrics[type][name] = res.metrics[type][name] || 0;
									res.metrics[type][name] = Math.max(res.metrics[type][name], value);
									break;
								case 'per':
									res.metrics[type][name]         = res.metrics[type][name] || {};
									res.metrics[type][name].account = (res.metrics[type][name].account || 0) + value.account;
									res.metrics[type][name].total   = (res.metrics[type][name].total || 0) + value.total;
									break;
								case 'avg':
									res.metrics[type][name]       = res.metrics[type][name] || {};
									res.metrics[type][name].sum   = (res.metrics[type][name].sum || 0) + value.sum;
									res.metrics[type][name].count = (res.metrics[type][name].count || 0) + value.count;
									break;
							}
						});
					});
				});
				// приводим значения к числовым
				res.metrics = _.mapValues(res.metrics, function(data, type) {
					return _.mapValues(data, function(value, name) {
						switch (type) {
							case 'per':
								return value.total ? _.round(value.account / value.total * 100, 3) : 0;
							case 'avg':
								return value.count ? _.round(value.sum / value.count, 3) : 0;
							default:
								return value;
						}
					});
				});

				return res;
			}).value();

			callback(null, result);
		});
	}
}

module.exports = new Nodestat();