#!/usr/bin/env node
import * as cdk from "aws-cdk-lib/core";
import { appConfig } from "../config.js";
import { AwsCdkBedrockKbWithS3AccessPointStack } from "../lib/aws-cdk-bedrock-kb-with-s3-access-point-stack.js";

const app = new cdk.App();
new AwsCdkBedrockKbWithS3AccessPointStack(
  app,
  "AwsCdkBedrockKbWithS3AccessPointStack",
  {
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION,
    },
    appConfig,
  }
);
