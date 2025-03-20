#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { CdkRdsIamStack } from '../lib/cdk-rds-iam';

const app = new cdk.App();
new CdkRdsIamStack(app, 'RdsLambdaIamStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});