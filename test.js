let config = require('./config');
let nodestat = require('./nodestat');
let MongoClient = require('mongodb').MongoClient;
let express = require('express');
let app = express();

app.get('/', (req, res) => {
  res.send('Hello, Nodestat');
});

MongoClient.connect('mongodb://localhost:27017/viboom', (err, db) => {

	config.app         = app; 
	config.mongoClient = db; 

	nodestat.init(config);
});

app.listen(3000);

console.log('http://localhost:3000');