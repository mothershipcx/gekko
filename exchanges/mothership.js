const _ = require('lodash');
const moment = require('moment');

const Errors = require('../core/error');
const log = require('../core/log');

const Mothership = require('mothership-js');

var Trader = function(config) {
  _.bindAll(this);
  console.log('created trader');
  console.log({ config: JSON.stringify(config) });

  if (_.isObject(config)) {
    this.key = config.key;
    this.secret = config.secret;
    this.currency = config.currency.toUpperCase();
    this.asset = config.asset.toUpperCase();
  }

  this.pair = this.asset + this.currency;
  this.name = 'mothership';

  this.market = _.find(Trader.getCapabilities().markets, market => {
    return market.pair[0] === this.currency && market.pair[1] === this.asset;
  });
};

var recoverableErrors = new RegExp(
  /(SOCKETTIMEDOUT|TIMEDOUT|CONNRESET|CONNREFUSED|NOTFOUND|Error -1021|Response code 429|Response code 5)/
);

Trader.prototype.processError = function(funcName, error) {
  if (!error) return undefined;

  if (!error.message || !error.message.match(recoverableErrors)) {
    log.error(
      `[mothership.js] (${funcName}) returned an irrecoverable error: ${error}`
    );
    return new Errors.AbortError('[mothership.js] ' + error.message || error);
  }

  log.debug(
    `[mothership.js] (${funcName}) returned an error, retrying: ${error}`
  );
  return new Errors.RetryError('[mothership.js] ' + error.message || error);
};

Trader.prototype.handleResponse = function(funcName, callback) {
  return (error, body) => {
    if (body && !_.isEmpty(body.code)) {
      error = new Error(`Error ${body.code}: ${body.msg}`);
    }

    return callback(this.processError(funcName, error), body);
  };
};

Trader.prototype.getTrades = function(since, callback, descending) {
  console.log('in getTrades');
  console.log({ pair: this.pair });
  console.log({ secret: this.secret });
  return Mothership.getTrades({
    instrument: this.pair,
  }).then(trades => {
    const adaptedTrades = trades.map(trade => ({
      date: moment(trade.time).unix(),
      price: trade.price,
      amount: trade.amount,
      // cur: experiment
      tid: trade.time,
    }));
    // console.log({ adaptedTrades });

    console.log('adapted trades')
    return callback(undefined, adaptedTrades);
  });
};

Trader.prototype.getPortfolio = function(callback) {
  console.log('in getPortfolio');
  console.log({key: this.key});
  console.log({secret: this.secret});

  return Mothership.getAccount({
    userId: this.key,
    accountId: this.secret,
  }).then(account => {
    console.log({ account });
    const adaptedBalances = account.balances.map(balance => ({
      amount: balance.available,
      name: balance.asset.toUpperCase(),
    }));
    console.log({ adaptedBalances });

    callback(undefined, adaptedBalances);
  });
};

Trader.prototype.getFee = function(callback) {
  // Temporarily zero.
  var makerFee = 0;
  callback(undefined, makerFee);
};

Trader.prototype.getTicker = function(callback) {
  console.log('get ticker in gekko');
  return Mothership.getTicker({ instrument: this.pair }).then(ticker =>
    callback(undefined, ticker)
  );
};

Trader.prototype.addOrder = function(side, amount, price, callback) {
  console.log('in addOrder');
  console.log({side})
  console.log({amount})
  console.log({price})
  console.log({userId: this.key})
  console.log({accountId: this.secret})
  console.log({instument: this.pair})

  return Mothership.postOrder({
    userId: this.key,
    accountId: this.secret,
    amount,
    price,
    instrument: this.pair,
    side,
    type: 'limit',
  }).then(order => {
    console.log({ order });

    callback(undefined, order);
  });
};

Trader.prototype.getOrder = function(order, callback) {
  console.log('in getOrder');

  return Mothership.getOrder({
    id: order,
  }).then(order => {
    console.log({ order });
    const adaptedOrder = {
      date: order.time,
      price: order.price,
      amount: order.amount,
    };
    console.log({ adaptedOrder });

    callback(undefined, adaptedOrder);
  });
};

Trader.prototype.buy = function(amount, price, callback) {
  return this.addOrder('bid', amount, price, callback);
};

Trader.prototype.sell = function(amount, price, callback) {
  return this.addOrder('ask', amount, price, callback);
};

Trader.prototype.checkOrder = function(order, callback) {
  console.log('in checkOrder');
  console.log({order})

  return Mothership.getOrder({
    id: order.id,
  }).then(order => {
    console.log({ order });
    const isFilled = order.status === 'FILLED';
    console.log({ isFilled });

    callback(undefined, isFilled);
  });
};

Trader.prototype.cancelOrder = function(order, callback) {
  console.log('in cancelOrder');
  console.log({order})

  return Mothership.deleteOrder({
    userId: this.key,
    accountId: this.secret,
    id: order.id,
    instrument: this.pair,
  }).then(order => {
    console.log({ order });

    callback(undefined);
  });
};

Trader.prototype.initMarkets = function(callback) {};

Trader.getCapabilities = function() {
  return {
    name: 'Mothership',
    slug: 'mothership',
    currencies: ['TTHR', 'USD', 'EUR', 'BTC'],
    assets: ['MSP', 'BTC', 'EUR', 'LTC', 'ETH'],
    markets: [
      {
        pair: ['TTHR', 'MSP'],
        minimalOrder: { amount: 1, unit: 'asset' },
        precision: 3,
      },

      {
        pair: ['USD', 'EUR'],
        minimalOrder: { amount: 5, unit: 'currency' },
        precision: 2,
      },

      {
        pair: ['USD', 'BTC'],
        minimalOrder: { amount: 5, unit: 'currency' },
        precision: 2,
      },
      {
        pair: ['EUR', 'BTC'],
        minimalOrder: { amount: 5, unit: 'currency' },
        precision: 2,
      },

      {
        pair: ['USD', 'LTC'],
        minimalOrder: { amount: 5, unit: 'currency' },
        precision: 2,
      },
      {
        pair: ['EUR', 'LTC'],
        minimalOrder: { amount: 5, unit: 'currency' },
        precision: 2,
      },
      {
        pair: ['BTC', 'LTC'],
        minimalOrder: { amount: 0.001, unit: 'currency' },
        precision: 8,
      },

      {
        pair: ['USD', 'ETH'],
        minimalOrder: { amount: 5, unit: 'currency' },
        precision: 2,
      },
      {
        pair: ['EUR', 'ETH'],
        minimalOrder: { amount: 5, unit: 'currency' },
        precision: 2,
      },
      {
        pair: ['BTC', 'ETH'],
        minimalOrder: { amount: 0.001, unit: 'currency' },
        precision: 8,
      },
    ],
    requires: ['key', 'secret'],
    providesHistory: 'tid',
    providesFullHistory: true,
    tid: 'tid',
    tradable: true,
  };
};

module.exports = Trader;
