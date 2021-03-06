const AWS = require('aws-sdk');
const d3 = require('d3-queue');
const message = require('@mapbox/lambda-cfn').message;
const splitOnComma = require('@mapbox/lambda-cfn').splitOnComma;

module.exports.fn = (event, context, callback) => {
  if (event.detail.errorCode) return callback(null, event.detail.errorMessage);
  let iam = new AWS.IAM();
  let q = d3.queue(1);
  let principal;
  let fullPrincipal;
  let arnRegex;

  console.log(`Processing event ${JSON.stringify(event.detail)}`);
  if (!event.detail.userIdentity || !event.detail.userIdentity.sessionContext) {
    return callback('Error: event.detail.userIdentity missing');
  }

  const ignoredServices = process.env.ignoredServices ? splitOnComma(process.env.ignoredServices) : [];

  let arn = event.detail.userIdentity.sessionContext.sessionIssuer.arn;
  if (process.env.principalRegex.toLowerCase() == 'none' || process.env.principalRegex == '') {
    principal = arn;
  } else {
    try {
      arnRegex = new RegExp(process.env.principalRegex, 'i');
    } catch (e) {
      console.log(`ERROR: Invalid regex ${process.env.principalRegex}, ${e}`);
      return callback(e);
    }
    if (arnRegex.test(arn)) {
      principal = arn;
    } else {
      console.log(`INFO: skipping principal ${arn}`);
      return callback();
    }
  }

  fullPrincipal = event.detail.userIdentity.arn.split('/').slice(-1)[0];

  let document = event.detail.requestParameters.policyDocument;
  let parsed = JSON.parse(document);

  let simulate = function(params, cb) {
    iam.simulatePrincipalPolicy(params, (err, data) => {
      cb(err, data);
    });
  };

  parsed.Statement.forEach((policy) => {
    policyProcessor(policy);
  });

  function policyProcessor(policy) {
    let actions = [];
    let resources = [];
    if (policy.Effect === 'Allow' && policy.Action) {
      actions = typeof policy.Action === 'string' ? [policy.Action] : policy.Action;
    }
    resources = typeof policy.Resource === 'string' ? [policy.Resource] : policy.Resource;

    const service = actions[0].split(':').slice(0)[0];
    if (ignoredServices.find(service)) {
      console.log(`${service} contained in ignoredServices list`);
    } else {
      resources.forEach((resource) => {
        let params = {
          PolicySourceArn: principal,
          ActionNames: actions,
          ResourceArns: [resource]
        };
        console.log(`Testing: ${JSON.stringify(params)}`);
        q.defer(simulate, params);
      });
    }
  }

  q.awaitAll(function(err, data) {
    if (err) return callback(err);
    let matches = [];
    let resultSets = [];
    let truncated = false;
    data.forEach(function(response) {
      // Warn on truncation.  Build paging support if this is hit.
      if (response.IsTruncated) truncated = true;
      response.EvaluationResults.forEach((result) => {
        if (/Deny/.test(result.EvalDecision)) {
          matches.push({
            Resource: result.EvalResourceName,
            Actions: result.EvalActionName,
            Decision: result.EvalDecision
          });
          resultSets.push(response.EvaluationResults);
        }
        console.log(`Result: ${JSON.stringify(result)}`);
      });
    });
    console.log(`Matches: ${JSON.stringify(matches)}`);

    // Report
    let q = d3.queue(1);
    if (truncated) {
      q.defer(message, {
        subject: 'Principal policy rule results truncated',
        summary: 'Principal policy rule results were truncated. Paging ' +
          'is not currently supported.'
      });
    }

    let iamResource = event.detail.requestParameters.policyArn ? event.detail.requestParameters.policyArn : event.detail.requestParameters.roleName;

    if (matches.length) {
      q.defer(message, {
        subject: `Principal ${fullPrincipal} allowed access to restricted resource`,
        summary: `${iamResource} grants principal ${fullPrincipal} access to restricted resource(s): ${JSON.stringify(matches)}`,
        event: `Result set: ${JSON.stringify(resultSets)} Event: ${JSON.stringify(event)}`
      });
    }

    q.awaitAll((err) => {
      callback(err);
    });
  });
};
