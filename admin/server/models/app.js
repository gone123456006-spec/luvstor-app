/**
 * Handles on the main app's collections. Schemaless on purpose: the app
 * backend owns these schemas; the admin service only reads them (plus a few
 * narrowly scoped $set/$inc updates in routes/users.js).
 */
const mongoose = require('mongoose');

const { Schema } = mongoose;

function appModel(name, collection) {
  const schema = new Schema(
    {},
    {
      strict: false,
      collection,
      autoIndex: false,
      autoCreate: false,
      versionKey: false,
      timestamps: false,
    },
  );
  return mongoose.model(`App${name}`, schema);
}

module.exports = {
  User: appModel('User', 'users'),
  Report: appModel('Report', 'reports'),
  SupportTicket: appModel('SupportTicket', 'supporttickets'),
  Call: appModel('Call', 'calls'),
  Referral: appModel('Referral', 'referrals'),
  Friendship: appModel('Friendship', 'friendships'),
  Message: appModel('Message', 'messages'),
  DeviceToken: appModel('DeviceToken', 'devicetokens'),
  ProfileView: appModel('ProfileView', 'profileviews'),
  ShortLink: appModel('ShortLink', 'shortlinks'),
};
