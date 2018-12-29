"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});

exports.default = function ({
  definitions,
  help,
  usage,
  start
}) {
  _commander2.default.loadDefinitions(definitions);
  if (usage) {
    _commander2.default.usage(usage);
  }
  if (help) {
    _commander2.default.on('--help', help);
  }
  _commander2.default.parse(process.argv, process.env);

  const options = _commander2.default.getOptions();
  start(_commander2.default, options, function () {
    logStartupOptions(options);
  });
};

var _commander = require("./commander");

var _commander2 = _interopRequireDefault(_commander);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function logStartupOptions(options) {
  for (const key in options) {
    let value = options[key];
    if (key == "masterKey") {
      value = "***REDACTED***";
    }
    if (typeof value === 'object') {
      try {
        value = JSON.stringify(value);
      } catch (e) {
        if (value && value.constructor && value.constructor.name) {
          value = value.constructor.name;
        }
      }
    }
    /* eslint-disable no-console */
    console.log(`${key}: ${value}`);
    /* eslint-enable no-console */
  }
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9jbGkvdXRpbHMvcnVubmVyLmpzIl0sIm5hbWVzIjpbImRlZmluaXRpb25zIiwiaGVscCIsInVzYWdlIiwic3RhcnQiLCJwcm9ncmFtIiwibG9hZERlZmluaXRpb25zIiwib24iLCJwYXJzZSIsInByb2Nlc3MiLCJhcmd2IiwiZW52Iiwib3B0aW9ucyIsImdldE9wdGlvbnMiLCJsb2dTdGFydHVwT3B0aW9ucyIsImtleSIsInZhbHVlIiwiSlNPTiIsInN0cmluZ2lmeSIsImUiLCJjb25zdHJ1Y3RvciIsIm5hbWUiLCJjb25zb2xlIiwibG9nIl0sIm1hcHBpbmdzIjoiOzs7Ozs7a0JBd0JlLFVBQVM7QUFDdEJBLGFBRHNCO0FBRXRCQyxNQUZzQjtBQUd0QkMsT0FIc0I7QUFJdEJDO0FBSnNCLENBQVQsRUFLWjtBQUNEQyxzQkFBUUMsZUFBUixDQUF3QkwsV0FBeEI7QUFDQSxNQUFJRSxLQUFKLEVBQVc7QUFDVEUsd0JBQVFGLEtBQVIsQ0FBY0EsS0FBZDtBQUNEO0FBQ0QsTUFBSUQsSUFBSixFQUFVO0FBQ1JHLHdCQUFRRSxFQUFSLENBQVcsUUFBWCxFQUFxQkwsSUFBckI7QUFDRDtBQUNERyxzQkFBUUcsS0FBUixDQUFjQyxRQUFRQyxJQUF0QixFQUE0QkQsUUFBUUUsR0FBcEM7O0FBRUEsUUFBTUMsVUFBVVAsb0JBQVFRLFVBQVIsRUFBaEI7QUFDQVQsUUFBTUMsbUJBQU4sRUFBZU8sT0FBZixFQUF3QixZQUFXO0FBQ2pDRSxzQkFBa0JGLE9BQWxCO0FBQ0QsR0FGRDtBQUdELEM7O0FBMUNEOzs7Ozs7QUFFQSxTQUFTRSxpQkFBVCxDQUEyQkYsT0FBM0IsRUFBb0M7QUFDbEMsT0FBSyxNQUFNRyxHQUFYLElBQWtCSCxPQUFsQixFQUEyQjtBQUN6QixRQUFJSSxRQUFRSixRQUFRRyxHQUFSLENBQVo7QUFDQSxRQUFJQSxPQUFPLFdBQVgsRUFBd0I7QUFDdEJDLGNBQVEsZ0JBQVI7QUFDRDtBQUNELFFBQUksT0FBT0EsS0FBUCxLQUFpQixRQUFyQixFQUErQjtBQUM3QixVQUFJO0FBQ0ZBLGdCQUFRQyxLQUFLQyxTQUFMLENBQWVGLEtBQWYsQ0FBUjtBQUNELE9BRkQsQ0FFRSxPQUFNRyxDQUFOLEVBQVM7QUFDVCxZQUFJSCxTQUFTQSxNQUFNSSxXQUFmLElBQThCSixNQUFNSSxXQUFOLENBQWtCQyxJQUFwRCxFQUEwRDtBQUN4REwsa0JBQVFBLE1BQU1JLFdBQU4sQ0FBa0JDLElBQTFCO0FBQ0Q7QUFDRjtBQUNGO0FBQ0Q7QUFDQUMsWUFBUUMsR0FBUixDQUFhLEdBQUVSLEdBQUksS0FBSUMsS0FBTSxFQUE3QjtBQUNBO0FBQ0Q7QUFDRiIsImZpbGUiOiJydW5uZXIuanMiLCJzb3VyY2VzQ29udGVudCI6WyJcbmltcG9ydCBwcm9ncmFtIGZyb20gJy4vY29tbWFuZGVyJztcblxuZnVuY3Rpb24gbG9nU3RhcnR1cE9wdGlvbnMob3B0aW9ucykge1xuICBmb3IgKGNvbnN0IGtleSBpbiBvcHRpb25zKSB7XG4gICAgbGV0IHZhbHVlID0gb3B0aW9uc1trZXldO1xuICAgIGlmIChrZXkgPT0gXCJtYXN0ZXJLZXlcIikge1xuICAgICAgdmFsdWUgPSBcIioqKlJFREFDVEVEKioqXCI7XG4gICAgfVxuICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnKSB7XG4gICAgICB0cnkge1xuICAgICAgICB2YWx1ZSA9IEpTT04uc3RyaW5naWZ5KHZhbHVlKVxuICAgICAgfSBjYXRjaChlKSB7XG4gICAgICAgIGlmICh2YWx1ZSAmJiB2YWx1ZS5jb25zdHJ1Y3RvciAmJiB2YWx1ZS5jb25zdHJ1Y3Rvci5uYW1lKSB7XG4gICAgICAgICAgdmFsdWUgPSB2YWx1ZS5jb25zdHJ1Y3Rvci5uYW1lO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIC8qIGVzbGludC1kaXNhYmxlIG5vLWNvbnNvbGUgKi9cbiAgICBjb25zb2xlLmxvZyhgJHtrZXl9OiAke3ZhbHVlfWApO1xuICAgIC8qIGVzbGludC1lbmFibGUgbm8tY29uc29sZSAqL1xuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHtcbiAgZGVmaW5pdGlvbnMsXG4gIGhlbHAsXG4gIHVzYWdlLFxuICBzdGFydFxufSkge1xuICBwcm9ncmFtLmxvYWREZWZpbml0aW9ucyhkZWZpbml0aW9ucyk7XG4gIGlmICh1c2FnZSkge1xuICAgIHByb2dyYW0udXNhZ2UodXNhZ2UpO1xuICB9XG4gIGlmIChoZWxwKSB7XG4gICAgcHJvZ3JhbS5vbignLS1oZWxwJywgaGVscCk7XG4gIH1cbiAgcHJvZ3JhbS5wYXJzZShwcm9jZXNzLmFyZ3YsIHByb2Nlc3MuZW52KTtcblxuICBjb25zdCBvcHRpb25zID0gcHJvZ3JhbS5nZXRPcHRpb25zKCk7XG4gIHN0YXJ0KHByb2dyYW0sIG9wdGlvbnMsIGZ1bmN0aW9uKCkge1xuICAgIGxvZ1N0YXJ0dXBPcHRpb25zKG9wdGlvbnMpO1xuICB9KTtcbn1cbiJdfQ==