// Runs the validator locally without DB or auth to show what would be stored.
require('dotenv').config();
const { validateSettings } = require('./lib/validateSettings');

const payload = {
  title: 'YN Paradise',
  currency: 'usd',
  price_mini: '3.50',
  price_basic: '4.00',
  price_unlimited: '0'
};

const res = validateSettings('general', payload);
console.log('Validator output:');
console.log(JSON.stringify(res, null, 2));

if (res.ok) {
  console.log('\nWould store (toStore for general merging):');
  console.log(JSON.stringify(res.cleaned, null, 2));
}
