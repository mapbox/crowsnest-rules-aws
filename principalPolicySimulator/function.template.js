var lambdaCfn = require('@mapbox/lambda-cfn');

module.exports = lambdaCfn.build({
  name: 'principalPolicySimulator',
  parameters: {
    principalRegex: {
      Type: 'String',
      Description: 'IAM Principal ARN matching regex, or "none" to test all principals'
    },
    ignoredServices: {
      Type: 'String',
      Description: 'Comma separated list of services to skip when testing'
    },
    ignoredResources: {
      Type: 'String',
      Description: 'Comma separated list of resources to skip when testing'
    }
  },
  statements: [
    {
      Effect: 'Allow',
      Action: ['iam:SimulatePrincipalPolicy'],
      Resource: '*'
    }
  ],
  eventSources: {
    cloudwatchEvent: {
      eventPattern:{
        'detail-type': [
          'AWS API Call via CloudTrail'
        ],
        detail: {
          eventSource: [
            'iam.amazonaws.com'
          ],
          eventName: [
            'CreatePolicy',
            'CreatePolicyVersion',
            'PutGroupPolicy',
            'PutRolePolicy',
            'PutUserPolicy'
          ]
        }
      }
    }
  }
});
