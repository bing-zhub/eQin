'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
const general = {
  'title': 'General request schema',
  'type': 'object',
  'properties': {
    'op': {
      'type': 'string',
      'enum': ['connect', 'subscribe', 'unsubscribe', 'update']
    }
  },
  'required': ['op']
};

const connect = {
  'title': 'Connect operation schema',
  'type': 'object',
  'properties': {
    'op': 'connect',
    'applicationId': {
      'type': 'string'
    },
    'javascriptKey': {
      type: 'string'
    },
    'masterKey': {
      type: 'string'
    },
    'clientKey': {
      type: 'string'
    },
    'windowsKey': {
      type: 'string'
    },
    'restAPIKey': {
      'type': 'string'
    },
    'sessionToken': {
      'type': 'string'
    }
  },
  'required': ['op', 'applicationId'],
  "additionalProperties": false
};

const subscribe = {
  'title': 'Subscribe operation schema',
  'type': 'object',
  'properties': {
    'op': 'subscribe',
    'requestId': {
      'type': 'number'
    },
    'query': {
      'title': 'Query field schema',
      'type': 'object',
      'properties': {
        'className': {
          'type': 'string'
        },
        'where': {
          'type': 'object'
        },
        'fields': {
          "type": "array",
          "items": {
            "type": "string"
          },
          "minItems": 1,
          "uniqueItems": true
        }
      },
      'required': ['where', 'className'],
      'additionalProperties': false
    },
    'sessionToken': {
      'type': 'string'
    }
  },
  'required': ['op', 'requestId', 'query'],
  'additionalProperties': false
};

const update = {
  'title': 'Update operation schema',
  'type': 'object',
  'properties': {
    'op': 'update',
    'requestId': {
      'type': 'number'
    },
    'query': {
      'title': 'Query field schema',
      'type': 'object',
      'properties': {
        'className': {
          'type': 'string'
        },
        'where': {
          'type': 'object'
        },
        'fields': {
          "type": "array",
          "items": {
            "type": "string"
          },
          "minItems": 1,
          "uniqueItems": true
        }
      },
      'required': ['where', 'className'],
      'additionalProperties': false
    },
    'sessionToken': {
      'type': 'string'
    }
  },
  'required': ['op', 'requestId', 'query'],
  'additionalProperties': false
};

const unsubscribe = {
  'title': 'Unsubscribe operation schema',
  'type': 'object',
  'properties': {
    'op': 'unsubscribe',
    'requestId': {
      'type': 'number'
    }
  },
  'required': ['op', 'requestId'],
  "additionalProperties": false
};

const RequestSchema = {
  'general': general,
  'connect': connect,
  'subscribe': subscribe,
  'update': update,
  'unsubscribe': unsubscribe
};

exports.default = RequestSchema;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9MaXZlUXVlcnkvUmVxdWVzdFNjaGVtYS5qcyJdLCJuYW1lcyI6WyJnZW5lcmFsIiwiY29ubmVjdCIsInR5cGUiLCJzdWJzY3JpYmUiLCJ1cGRhdGUiLCJ1bnN1YnNjcmliZSIsIlJlcXVlc3RTY2hlbWEiXSwibWFwcGluZ3MiOiI7Ozs7O0FBQUEsTUFBTUEsVUFBVTtBQUNkLFdBQVMsd0JBREs7QUFFZCxVQUFRLFFBRk07QUFHZCxnQkFBYztBQUNaLFVBQU07QUFDSixjQUFRLFFBREo7QUFFSixjQUFRLENBQUMsU0FBRCxFQUFZLFdBQVosRUFBeUIsYUFBekIsRUFBd0MsUUFBeEM7QUFGSjtBQURNLEdBSEE7QUFTZCxjQUFZLENBQUMsSUFBRDtBQVRFLENBQWhCOztBQVlBLE1BQU1DLFVBQVc7QUFDZixXQUFTLDBCQURNO0FBRWYsVUFBUSxRQUZPO0FBR2YsZ0JBQWM7QUFDWixVQUFNLFNBRE07QUFFWixxQkFBaUI7QUFDZixjQUFRO0FBRE8sS0FGTDtBQUtaLHFCQUFpQjtBQUNmQyxZQUFNO0FBRFMsS0FMTDtBQVFaLGlCQUFhO0FBQ1hBLFlBQU07QUFESyxLQVJEO0FBV1osaUJBQWE7QUFDWEEsWUFBTTtBQURLLEtBWEQ7QUFjWixrQkFBYztBQUNaQSxZQUFNO0FBRE0sS0FkRjtBQWlCWixrQkFBYztBQUNaLGNBQVE7QUFESSxLQWpCRjtBQW9CWixvQkFBZ0I7QUFDZCxjQUFRO0FBRE07QUFwQkosR0FIQztBQTJCZixjQUFZLENBQUMsSUFBRCxFQUFPLGVBQVAsQ0EzQkc7QUE0QmYsMEJBQXdCO0FBNUJULENBQWpCOztBQStCQSxNQUFNQyxZQUFZO0FBQ2hCLFdBQVMsNEJBRE87QUFFaEIsVUFBUSxRQUZRO0FBR2hCLGdCQUFjO0FBQ1osVUFBTSxXQURNO0FBRVosaUJBQWE7QUFDWCxjQUFRO0FBREcsS0FGRDtBQUtaLGFBQVM7QUFDUCxlQUFTLG9CQURGO0FBRVAsY0FBUSxRQUZEO0FBR1Asb0JBQWM7QUFDWixxQkFBYTtBQUNYLGtCQUFRO0FBREcsU0FERDtBQUlaLGlCQUFTO0FBQ1Asa0JBQVE7QUFERCxTQUpHO0FBT1osa0JBQVU7QUFDUixrQkFBUSxPQURBO0FBRVIsbUJBQVM7QUFDUCxvQkFBUTtBQURELFdBRkQ7QUFLUixzQkFBWSxDQUxKO0FBTVIseUJBQWU7QUFOUDtBQVBFLE9BSFA7QUFtQlAsa0JBQVksQ0FBQyxPQUFELEVBQVUsV0FBVixDQW5CTDtBQW9CUCw4QkFBd0I7QUFwQmpCLEtBTEc7QUEyQlosb0JBQWdCO0FBQ2QsY0FBUTtBQURNO0FBM0JKLEdBSEU7QUFrQ2hCLGNBQVksQ0FBQyxJQUFELEVBQU8sV0FBUCxFQUFvQixPQUFwQixDQWxDSTtBQW1DaEIsMEJBQXdCO0FBbkNSLENBQWxCOztBQXNDQSxNQUFNQyxTQUFTO0FBQ2IsV0FBUyx5QkFESTtBQUViLFVBQVEsUUFGSztBQUdiLGdCQUFjO0FBQ1osVUFBTSxRQURNO0FBRVosaUJBQWE7QUFDWCxjQUFRO0FBREcsS0FGRDtBQUtaLGFBQVM7QUFDUCxlQUFTLG9CQURGO0FBRVAsY0FBUSxRQUZEO0FBR1Asb0JBQWM7QUFDWixxQkFBYTtBQUNYLGtCQUFRO0FBREcsU0FERDtBQUlaLGlCQUFTO0FBQ1Asa0JBQVE7QUFERCxTQUpHO0FBT1osa0JBQVU7QUFDUixrQkFBUSxPQURBO0FBRVIsbUJBQVM7QUFDUCxvQkFBUTtBQURELFdBRkQ7QUFLUixzQkFBWSxDQUxKO0FBTVIseUJBQWU7QUFOUDtBQVBFLE9BSFA7QUFtQlAsa0JBQVksQ0FBQyxPQUFELEVBQVUsV0FBVixDQW5CTDtBQW9CUCw4QkFBd0I7QUFwQmpCLEtBTEc7QUEyQlosb0JBQWdCO0FBQ2QsY0FBUTtBQURNO0FBM0JKLEdBSEQ7QUFrQ2IsY0FBWSxDQUFDLElBQUQsRUFBTyxXQUFQLEVBQW9CLE9BQXBCLENBbENDO0FBbUNiLDBCQUF3QjtBQW5DWCxDQUFmOztBQXNDQSxNQUFNQyxjQUFjO0FBQ2xCLFdBQVMsOEJBRFM7QUFFbEIsVUFBUSxRQUZVO0FBR2xCLGdCQUFjO0FBQ1osVUFBTSxhQURNO0FBRVosaUJBQWE7QUFDWCxjQUFRO0FBREc7QUFGRCxHQUhJO0FBU2xCLGNBQVksQ0FBQyxJQUFELEVBQU8sV0FBUCxDQVRNO0FBVWxCLDBCQUF3QjtBQVZOLENBQXBCOztBQWFBLE1BQU1DLGdCQUFnQjtBQUNwQixhQUFXTixPQURTO0FBRXBCLGFBQVdDLE9BRlM7QUFHcEIsZUFBYUUsU0FITztBQUlwQixZQUFVQyxNQUpVO0FBS3BCLGlCQUFlQztBQUxLLENBQXRCOztrQkFRZUMsYSIsImZpbGUiOiJSZXF1ZXN0U2NoZW1hLmpzIiwic291cmNlc0NvbnRlbnQiOlsiY29uc3QgZ2VuZXJhbCA9IHtcbiAgJ3RpdGxlJzogJ0dlbmVyYWwgcmVxdWVzdCBzY2hlbWEnLFxuICAndHlwZSc6ICdvYmplY3QnLFxuICAncHJvcGVydGllcyc6IHtcbiAgICAnb3AnOiB7XG4gICAgICAndHlwZSc6ICdzdHJpbmcnLFxuICAgICAgJ2VudW0nOiBbJ2Nvbm5lY3QnLCAnc3Vic2NyaWJlJywgJ3Vuc3Vic2NyaWJlJywgJ3VwZGF0ZSddXG4gICAgfSxcbiAgfSxcbiAgJ3JlcXVpcmVkJzogWydvcCddXG59O1xuXG5jb25zdCBjb25uZWN0ID0gIHtcbiAgJ3RpdGxlJzogJ0Nvbm5lY3Qgb3BlcmF0aW9uIHNjaGVtYScsXG4gICd0eXBlJzogJ29iamVjdCcsXG4gICdwcm9wZXJ0aWVzJzoge1xuICAgICdvcCc6ICdjb25uZWN0JyxcbiAgICAnYXBwbGljYXRpb25JZCc6IHtcbiAgICAgICd0eXBlJzogJ3N0cmluZydcbiAgICB9LFxuICAgICdqYXZhc2NyaXB0S2V5Jzoge1xuICAgICAgdHlwZTogJ3N0cmluZydcbiAgICB9LFxuICAgICdtYXN0ZXJLZXknOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJ1xuICAgIH0sXG4gICAgJ2NsaWVudEtleSc6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnXG4gICAgfSxcbiAgICAnd2luZG93c0tleSc6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnXG4gICAgfSxcbiAgICAncmVzdEFQSUtleSc6IHtcbiAgICAgICd0eXBlJzogJ3N0cmluZydcbiAgICB9LFxuICAgICdzZXNzaW9uVG9rZW4nOiB7XG4gICAgICAndHlwZSc6ICdzdHJpbmcnXG4gICAgfVxuICB9LFxuICAncmVxdWlyZWQnOiBbJ29wJywgJ2FwcGxpY2F0aW9uSWQnXSxcbiAgXCJhZGRpdGlvbmFsUHJvcGVydGllc1wiOiBmYWxzZVxufTtcblxuY29uc3Qgc3Vic2NyaWJlID0ge1xuICAndGl0bGUnOiAnU3Vic2NyaWJlIG9wZXJhdGlvbiBzY2hlbWEnLFxuICAndHlwZSc6ICdvYmplY3QnLFxuICAncHJvcGVydGllcyc6IHtcbiAgICAnb3AnOiAnc3Vic2NyaWJlJyxcbiAgICAncmVxdWVzdElkJzoge1xuICAgICAgJ3R5cGUnOiAnbnVtYmVyJ1xuICAgIH0sXG4gICAgJ3F1ZXJ5Jzoge1xuICAgICAgJ3RpdGxlJzogJ1F1ZXJ5IGZpZWxkIHNjaGVtYScsXG4gICAgICAndHlwZSc6ICdvYmplY3QnLFxuICAgICAgJ3Byb3BlcnRpZXMnOiB7XG4gICAgICAgICdjbGFzc05hbWUnOiB7XG4gICAgICAgICAgJ3R5cGUnOiAnc3RyaW5nJ1xuICAgICAgICB9LFxuICAgICAgICAnd2hlcmUnOiB7XG4gICAgICAgICAgJ3R5cGUnOiAnb2JqZWN0J1xuICAgICAgICB9LFxuICAgICAgICAnZmllbGRzJzoge1xuICAgICAgICAgIFwidHlwZVwiOiBcImFycmF5XCIsXG4gICAgICAgICAgXCJpdGVtc1wiOiB7XG4gICAgICAgICAgICBcInR5cGVcIjogXCJzdHJpbmdcIlxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJtaW5JdGVtc1wiOiAxLFxuICAgICAgICAgIFwidW5pcXVlSXRlbXNcIjogdHJ1ZVxuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgJ3JlcXVpcmVkJzogWyd3aGVyZScsICdjbGFzc05hbWUnXSxcbiAgICAgICdhZGRpdGlvbmFsUHJvcGVydGllcyc6IGZhbHNlXG4gICAgfSxcbiAgICAnc2Vzc2lvblRva2VuJzoge1xuICAgICAgJ3R5cGUnOiAnc3RyaW5nJ1xuICAgIH1cbiAgfSxcbiAgJ3JlcXVpcmVkJzogWydvcCcsICdyZXF1ZXN0SWQnLCAncXVlcnknXSxcbiAgJ2FkZGl0aW9uYWxQcm9wZXJ0aWVzJzogZmFsc2Vcbn07XG5cbmNvbnN0IHVwZGF0ZSA9IHtcbiAgJ3RpdGxlJzogJ1VwZGF0ZSBvcGVyYXRpb24gc2NoZW1hJyxcbiAgJ3R5cGUnOiAnb2JqZWN0JyxcbiAgJ3Byb3BlcnRpZXMnOiB7XG4gICAgJ29wJzogJ3VwZGF0ZScsXG4gICAgJ3JlcXVlc3RJZCc6IHtcbiAgICAgICd0eXBlJzogJ251bWJlcidcbiAgICB9LFxuICAgICdxdWVyeSc6IHtcbiAgICAgICd0aXRsZSc6ICdRdWVyeSBmaWVsZCBzY2hlbWEnLFxuICAgICAgJ3R5cGUnOiAnb2JqZWN0JyxcbiAgICAgICdwcm9wZXJ0aWVzJzoge1xuICAgICAgICAnY2xhc3NOYW1lJzoge1xuICAgICAgICAgICd0eXBlJzogJ3N0cmluZydcbiAgICAgICAgfSxcbiAgICAgICAgJ3doZXJlJzoge1xuICAgICAgICAgICd0eXBlJzogJ29iamVjdCdcbiAgICAgICAgfSxcbiAgICAgICAgJ2ZpZWxkcyc6IHtcbiAgICAgICAgICBcInR5cGVcIjogXCJhcnJheVwiLFxuICAgICAgICAgIFwiaXRlbXNcIjoge1xuICAgICAgICAgICAgXCJ0eXBlXCI6IFwic3RyaW5nXCJcbiAgICAgICAgICB9LFxuICAgICAgICAgIFwibWluSXRlbXNcIjogMSxcbiAgICAgICAgICBcInVuaXF1ZUl0ZW1zXCI6IHRydWVcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgICdyZXF1aXJlZCc6IFsnd2hlcmUnLCAnY2xhc3NOYW1lJ10sXG4gICAgICAnYWRkaXRpb25hbFByb3BlcnRpZXMnOiBmYWxzZVxuICAgIH0sXG4gICAgJ3Nlc3Npb25Ub2tlbic6IHtcbiAgICAgICd0eXBlJzogJ3N0cmluZydcbiAgICB9XG4gIH0sXG4gICdyZXF1aXJlZCc6IFsnb3AnLCAncmVxdWVzdElkJywgJ3F1ZXJ5J10sXG4gICdhZGRpdGlvbmFsUHJvcGVydGllcyc6IGZhbHNlXG59O1xuXG5jb25zdCB1bnN1YnNjcmliZSA9IHtcbiAgJ3RpdGxlJzogJ1Vuc3Vic2NyaWJlIG9wZXJhdGlvbiBzY2hlbWEnLFxuICAndHlwZSc6ICdvYmplY3QnLFxuICAncHJvcGVydGllcyc6IHtcbiAgICAnb3AnOiAndW5zdWJzY3JpYmUnLFxuICAgICdyZXF1ZXN0SWQnOiB7XG4gICAgICAndHlwZSc6ICdudW1iZXInXG4gICAgfVxuICB9LFxuICAncmVxdWlyZWQnOiBbJ29wJywgJ3JlcXVlc3RJZCddLFxuICBcImFkZGl0aW9uYWxQcm9wZXJ0aWVzXCI6IGZhbHNlXG59XG5cbmNvbnN0IFJlcXVlc3RTY2hlbWEgPSB7XG4gICdnZW5lcmFsJzogZ2VuZXJhbCxcbiAgJ2Nvbm5lY3QnOiBjb25uZWN0LFxuICAnc3Vic2NyaWJlJzogc3Vic2NyaWJlLFxuICAndXBkYXRlJzogdXBkYXRlLFxuICAndW5zdWJzY3JpYmUnOiB1bnN1YnNjcmliZVxufVxuXG5leHBvcnQgZGVmYXVsdCBSZXF1ZXN0U2NoZW1hO1xuIl19