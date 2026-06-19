#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { HkthonStack } from '../lib/hkthon-stack';

const app = new cdk.App();

// Region is fixed to Seoul per STACK.md §4. Account resolves from the
// ambient AWS credentials (CDK_DEFAULT_ACCOUNT) so `cdk synth` works for any
// team member without hardcoding the account id.
new HkthonStack(app, 'HkthonStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'ap-northeast-2',
  },
  description: 'AI 상담 코파일럿 — booth demo serverless stack (CLOUD-011)',
});
