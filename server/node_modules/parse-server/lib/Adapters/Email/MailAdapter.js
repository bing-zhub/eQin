"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
/*eslint no-unused-vars: "off"*/
/*
  Mail Adapter prototype
  A MailAdapter should implement at least sendMail()
 */
class MailAdapter {
  /*
   * A method for sending mail
   * @param options would have the parameters
   * - to: the recipient
   * - text: the raw text of the message
   * - subject: the subject of the email
   */
  sendMail(options) {}

  /* You can implement those methods if you want
   * to provide HTML templates etc...
   */
  // sendVerificationEmail({ link, appName, user }) {}
  // sendPasswordResetEmail({ link, appName, user }) {}
}

exports.MailAdapter = MailAdapter;
exports.default = MailAdapter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9BZGFwdGVycy9FbWFpbC9NYWlsQWRhcHRlci5qcyJdLCJuYW1lcyI6WyJNYWlsQWRhcHRlciIsInNlbmRNYWlsIiwib3B0aW9ucyJdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBQTtBQUNBOzs7O0FBSU8sTUFBTUEsV0FBTixDQUFrQjtBQUN2Qjs7Ozs7OztBQU9BQyxXQUFTQyxPQUFULEVBQWtCLENBQUU7O0FBRXBCOzs7QUFHQTtBQUNBO0FBZHVCOztRQUFaRixXLEdBQUFBLFc7a0JBaUJFQSxXIiwiZmlsZSI6Ik1haWxBZGFwdGVyLmpzIiwic291cmNlc0NvbnRlbnQiOlsiLyplc2xpbnQgbm8tdW51c2VkLXZhcnM6IFwib2ZmXCIqL1xuLypcbiAgTWFpbCBBZGFwdGVyIHByb3RvdHlwZVxuICBBIE1haWxBZGFwdGVyIHNob3VsZCBpbXBsZW1lbnQgYXQgbGVhc3Qgc2VuZE1haWwoKVxuICovXG5leHBvcnQgY2xhc3MgTWFpbEFkYXB0ZXIge1xuICAvKlxuICAgKiBBIG1ldGhvZCBmb3Igc2VuZGluZyBtYWlsXG4gICAqIEBwYXJhbSBvcHRpb25zIHdvdWxkIGhhdmUgdGhlIHBhcmFtZXRlcnNcbiAgICogLSB0bzogdGhlIHJlY2lwaWVudFxuICAgKiAtIHRleHQ6IHRoZSByYXcgdGV4dCBvZiB0aGUgbWVzc2FnZVxuICAgKiAtIHN1YmplY3Q6IHRoZSBzdWJqZWN0IG9mIHRoZSBlbWFpbFxuICAgKi9cbiAgc2VuZE1haWwob3B0aW9ucykge31cblxuICAvKiBZb3UgY2FuIGltcGxlbWVudCB0aG9zZSBtZXRob2RzIGlmIHlvdSB3YW50XG4gICAqIHRvIHByb3ZpZGUgSFRNTCB0ZW1wbGF0ZXMgZXRjLi4uXG4gICAqL1xuICAvLyBzZW5kVmVyaWZpY2F0aW9uRW1haWwoeyBsaW5rLCBhcHBOYW1lLCB1c2VyIH0pIHt9XG4gIC8vIHNlbmRQYXNzd29yZFJlc2V0RW1haWwoeyBsaW5rLCBhcHBOYW1lLCB1c2VyIH0pIHt9XG59XG5cbmV4cG9ydCBkZWZhdWx0IE1haWxBZGFwdGVyO1xuIl19