import * as cdk from "aws-cdk-lib/core";
import { Construct } from "constructs";
import type { AppConfig } from "../config.js";
import { IngestionSchedule, KnowledgeBase } from "./constructs/index.js";

export interface AwsCdkBedrockKbWithS3AccessPointStackProps
  extends cdk.StackProps {
  readonly appConfig: AppConfig;
}

export class AwsCdkBedrockKbWithS3AccessPointStack extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    props: AwsCdkBedrockKbWithS3AccessPointStackProps,
  ) {
    super(scope, id, props);

    const kb = new KnowledgeBase(this, "KnowledgeBase", {
      vectorBucketName: props.appConfig.vectorBucketName,
      s3AccessPoints: props.appConfig.s3AccessPoints,
      embeddingModelId: props.appConfig.embeddingModel?.modelId,
      embeddingDimensions: props.appConfig.embeddingModel?.dimensions,
    });

    new cdk.CfnOutput(this, "KnowledgeBaseId", {
      value: kb.knowledgeBaseId,
    });

    // DataSource がある場合のみ IngestionSchedule を作成
    if (kb.dataSourceIds.length > 0) {
      const ingestion = new IngestionSchedule(this, "IngestionSchedule", {
        knowledgeBaseId: kb.knowledgeBaseId,
        dataSourceIds: kb.dataSourceIds,
        schedule: props.appConfig.syncSchedule,
      });

      kb.dataSourceIds.forEach((dsId, index) => {
        new cdk.CfnOutput(this, `DataSourceId${index}`, {
          value: dsId,
        });
      });

      new cdk.CfnOutput(this, "StateMachineArn", {
        value: ingestion.stateMachineArn,
      });
    }
  }
}
