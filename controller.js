 'use strict';

const _        = require('lodash');
const fs       = require('fs');
const url      = require('url');
const ejs      = require('ejs');
const moment   = require('moment');
const nodestat = require('./nodestat');

let template = ejs.compile(fs.readFileSync(`${__dirname}/template.html`).toString());

module.exports = (options) => {

	let {app, period, interval} = options;

	app.get('/nodestat/json', function(req, res, next){
		let referer = url.parse(req.headers.referer, true);
		let limit   = parseInt(req.query.limit || referer.query.limit) || 3;

		let domain  = req.query.domain || options.domain;
		let group   = req.query.group || referer.query.group || 'minute';
		let pick    = req.query.pick || referer.query.pick || null;
		let metric  = req.query.metric || referer.query.metric || null;
		let since   = parseInt(req.query.since) || 0;
		since = since ? new Date(since) : moment().add(-limit, 'hour').toDate();

		console.time('nodestat.getHistory');
		nodestat.getHistory(domain, since, group, pick, metric, function(err, result){
			console.timeEnd('nodestat.getHistory');
			if (req.timedout) {
				return console.error('Nodestat getHistory timedout');
			}
			res.jsonp({
				error  : err,
				where  : {
					domain : domain,
					group  : group,
					since  : since
				},
				result : result
			});
		})
	});

	app.get('/nodestat', function(req, res, next){

		let pool    = options.pool || []; //[{domain:'localhost:3333'}]
		let domains = _.map(pool, 'domain');
		let domain  = req.query.domain;

		if (domains.indexOf(domain) !== -1) {
			domains = [domain];
		}

		res.setHeader('content-type', 'text/html');

		res.end(template({
			options : {period, interval},
			pool    : pool,
			query   : req.query
		}));
	});
}

