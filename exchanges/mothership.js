const moment = require('moment');
const _ = require('lodash');

const util = require('../core/util');
const Errors = require('../core/error');
const log = require('../core/log');

// const mothership = require('mothership');
const Mothership = require('mothership-js');

var Trader = function(config) {
  _.bindAll(this);
  console.log('created trader console');
  log.debug('created trader');

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

  // this.mothership = new mothership.mothershipRest({
  //   key: this.key,
  //   secret: this.secret,
  //   timeout: 15000,
  //   recvWindow: 60000, // suggested by mothership
  //   disableBeautification: false,
  //   handleDrift: true,
  // });
};

var retryCritical = {
  retries: 10,
  factor: 1.2,
  minTimeout: 1 * 1000,
  maxTimeout: 30 * 1000,
};

var retryForever = {
  forever: true,
  factor: 1.2,
  minTimeout: 10 * 1000,
  maxTimeout: 30 * 1000,
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
  log.debug('in getTrades');
  // todo: add a method in api to get all trades
  Mothership.getAccountTrades({
    userId: this.key,
    accountId: this.secret,
    instrument: 'MSPTTHR', // cur: take from asset
  }).then(trades => {
    log.debug({ trades });
    const adaptedTrades = trades.map(trade => ({
      date: trade.time,
      price: trade.price,
      amount: trade.amount,
      tid: trade.id,
    }));
    log.debug({ adaptedTrades });

    callback(undefined, adaptedTrades);
  });
};

Trader.prototype.getPortfolio = function(callback) {
  log.debug('in getPortfolio');

  Mothership.getAccount({
    userId: this.key,
    accountId: this.secret,
  }).then(account => {
    log.debug({ account });
    const adaptedBalances = account.balances.map(balance => ({
      amount: balance.available,
      name: balance.asset,
    }));
    log.debug({ adaptedBalances });

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
  return Mothership.getTicker({ instrument: this.market }).then(callback);
};

// Effectively counts the number of decimal places, so 0.001 or 0.234 results in 3
Trader.prototype.getPrecision = function(tickSize) {
  if (!isFinite(tickSize)) return 0;
  var e = 1,
    p = 0;
  while (Math.round(tickSize * e) / e !== tickSize) {
    e *= 10;
    p++;
  }
  return p;
};

Trader.prototype.roundAmount = function(amount, tickSize) {
  var precision = 100000000;
  var t = this.getPrecision(tickSize);

  if (Number.isInteger(t)) precision = Math.pow(10, t);

  amount *= precision;
  amount = Math.floor(amount);
  amount /= precision;
  return amount;
};

// Trader.prototype.getLotSize = function(tradeType, amount, price, callback) {
//   amount = this.roundAmount(amount, this.market.minimalOrder.amount);
//   if (amount < this.market.minimalOrder.amount)
//     return callback(undefined, { amount: 0, price: 0 });
//
//   price = this.roundAmount(price, this.market.minimalOrder.price);
//   if (price < this.market.minimalOrder.price)
//     return callback(undefined, { amount: 0, price: 0 });
//
//   if (amount * price < this.market.minimalOrder.order)
//     return callback(undefined, { amount: 0, price: 0 });
//
//   callback(undefined, { amount: amount, price: price });
// };

Trader.prototype.addOrder = function(tradeType, amount, price, callback) {
  log.debug(
    `[mothership.js] (addOrder) ${tradeType.toUpperCase()} ${amount} ${
      this.asset
    } @${price} ${this.currency}`
  );

  var setOrder = function(err, data) {
    log.debug(
      `[mothership.js] entering "setOrder" callback after api call, err: ${err} data: ${JSON.stringify(
        data
      )}`
    );
    if (err) return callback(err);

    var txid = data.orderId;
    log.debug(`[mothership.js] added order with txid: ${txid}`);

    callback(undefined, txid);
  };

  let reqData = {
    symbol: this.pair,
    side: tradeType.toUpperCase(),
    type: 'LIMIT',
    timeInForce: 'GTC', // Good to cancel (I think, not really covered in docs, but is default)
    quantity: amount,
    price: price,
    timestamp: new Date().getTime(),
  };

  let handler = cb =>
    this.mothership.newOrder(reqData, this.handleResponse('addOrder', cb));
  util.retryCustom(
    retryCritical,
    _.bind(handler, this),
    _.bind(setOrder, this)
  );
};

Trader.prototype.getOrder = function(order, callback) {
  log.debug('in getOrder');

  Mothership.getOrder({
    id: order,
  }).then(order => {
    log.debug({ order });
    const adaptedOrder = {
      date: order.time,
      price: order.price,
      amount: order.amount,
    };
    log.debug({ adaptedOrder });

    callback(undefined, adaptedOrder);
  });
};

Trader.prototype.buy = function(amount, price, callback) {
  this.addOrder('buy', amount, price, callback);
};

Trader.prototype.sell = function(amount, price, callback) {
  this.addOrder('sell', amount, price, callback);
};

Trader.prototype.checkOrder = function(order, callback) {
  var check = function(err, data) {
    log.debug(
      `[mothership.js] entering "checkOrder" callback after api call, err ${err} data: ${JSON.stringify(
        data
      )}`
    );
    if (err) return callback(err);

    var stillThere =
      data.status === 'NEW' || data.status === 'PARTIALLY_FILLED';
    var canceledManually =
      data.status === 'CANCELED' ||
      data.status === 'REJECTED' ||
      data.status === 'EXPIRED';
    callback(undefined, !stillThere && !canceledManually);
  };

  let reqData = {
    symbol: this.pair,
    orderId: order,
  };

  let handler = cb =>
    this.mothership.queryOrder(reqData, this.handleResponse('checkOrder', cb));
  util.retryCustom(retryCritical, _.bind(handler, this), _.bind(check, this));
};

Trader.prototype.cancelOrder = function(order, callback) {
  // callback for cancelOrder should be true if the order was already filled, otherwise false
  var cancel = function(err, data) {
    log.debug(
      `[mothership.js] entering "cancelOrder" callback after api call, err ${err} data: ${JSON.stringify(
        data
      )}`
    );
    if (err) {
      if (data && data.msg === 'UNKNOWN_ORDER') {
        // this seems to be the response we get when an order was filled
        return callback(true); // tell the thing the order was already filled
      }
      return callback(err);
    }
    callback(undefined);
  };

  let reqData = {
    symbol: this.pair,
    orderId: order,
  };

  let handler = cb =>
    this.mothership.cancelOrder(
      reqData,
      this.handleResponse('cancelOrder', cb)
    );
  util.retryCustom(retryForever, _.bind(handler, this), _.bind(cancel, this));
};

Trader.prototype.initMarkets = function(callback) {};

Trader.getCapabilities = function() {
  return {
    name: 'Mothership',
    slug: 'mothership',
    currencies: ['USD', 'EUR', 'BTC'],
    assets: ['BTC', 'EUR', 'LTC', 'ETH'],
    markets: [
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
    providesHistory: false,
    tid: 'tid',
    tradable: true,
  };
};

module.exports = Trader;
