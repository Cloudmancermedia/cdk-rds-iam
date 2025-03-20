#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { RdsLambdaIamStack } from '../lib/rds-lambda-iam-stack';

const app = new cdk.App();
new RdsLambdaIamStack(app, 'RdsLambdaIamStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});