const detect = require('./detect');
const runner = require('./runner');

module.exports = {
  ...detect,
  ...runner,
};
